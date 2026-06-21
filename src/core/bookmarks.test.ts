import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Classification, FlatBookmark } from '../types';
import {
  bucketByCategory,
  findBookmarksBarId,
  flattenTree,
  removeGeneratedFolder,
  shouldUseTwoLevel,
  writeOrganized,
} from './bookmarks';

describe('flattenTree', () => {
  it('只收集有 url 的叶子节点并保留父级路径', () => {
    const tree: chrome.bookmarks.BookmarkTreeNode[] = [
      {
        id: '0',
        title: '',
        syncing: false,
        children: [
          {
            id: '1',
            title: '书签栏',
            syncing: false,
            children: [
              { id: '2', title: 'GitHub', url: 'https://github.com/', syncing: false },
              {
                id: '3',
                title: '开发',
                syncing: false,
                children: [{ id: '4', title: '', url: 'https://developer.chrome.com/', syncing: false }],
              },
            ],
          },
        ],
      },
    ];

    expect(flattenTree(tree)).toEqual([
      {
        id: '2',
        title: 'GitHub',
        url: 'https://github.com/',
        parentPath: '书签栏',
      },
      {
        id: '4',
        title: 'https://developer.chrome.com/',
        url: 'https://developer.chrome.com/',
        parentPath: '书签栏/开发',
      },
    ]);
  });
});

describe('bucketByCategory', () => {
  const bookmarks: FlatBookmark[] = [
    { id: 'a', title: 'A', url: 'https://a.example/' },
    { id: 'b', title: 'B', url: 'https://b.example/' },
    { id: 'c', title: 'C', url: 'https://c.example/' },
  ];
  const categories: Category[] = [{ name: '开发工具', description: '工程相关' }];

  it('未知类目和漏判书签都进入其他', () => {
    const classifications: Classification[] = [
      { bookmarkId: 'a', category: '开发工具', confidence: 0.9 },
      { bookmarkId: 'b', category: '不存在的类目', confidence: 0.4 },
    ];

    const buckets = bucketByCategory(bookmarks, categories, classifications);

    expect(buckets.get('开发工具')).toEqual([bookmarks[0]]);
    expect(buckets.get('其他')).toEqual([bookmarks[1], bookmarks[2]]);
  });

  it('重复 bookmarkId 只采用第一条分类,避免写入重复副本', () => {
    const classifications: Classification[] = [
      { bookmarkId: 'a', category: '开发工具', confidence: 0.9 },
      { bookmarkId: 'a', category: '不存在的类目', confidence: 0.2 },
    ];

    const buckets = bucketByCategory(bookmarks, categories, classifications);

    expect(buckets.get('开发工具')).toEqual([bookmarks[0]]);
    expect(buckets.get('其他')).toEqual([bookmarks[1], bookmarks[2]]);
  });
});

describe('findBookmarksBarId', () => {
  it('优先返回 Chrome 书签栏 root id', () => {
    expect(
      findBookmarksBarId([
        {
          id: '0',
          title: '',
          syncing: false,
          children: [
            { id: '1', title: '书签栏', syncing: false },
            { id: '2', title: '其他书签', syncing: false },
          ],
        },
      ]),
    ).toBe('1');
  });
});

describe('writeOrganized', () => {
  beforeEach(() => {
    let createdId = 10;
    vi.stubGlobal('chrome', {
      bookmarks: {
        getTree: vi.fn(async () => [
          {
            id: '0',
            title: '',
            syncing: false,
            children: [
              { id: '1', title: '书签栏', syncing: false },
              { id: '2', title: '其他书签', syncing: false },
            ],
          },
        ]),
        create: vi.fn(async () => ({ id: String((createdId += 1)) })),
      },
    });
  });

  it('新建输出根目录后回传 rootFolderId,便于失败后清理', async () => {
    const onRootCreated = vi.fn();
    const rootFolderId = await writeOrganized(
      [{ id: 'a', title: 'A', url: 'https://a.example/' }],
      [{ name: '工具', description: '工具站点' }],
      [{ bookmarkId: 'a', category: '工具', confidence: 0.9 }],
      onRootCreated,
    );

    expect(rootFolderId).toBe('11');
    expect(onRootCreated).toHaveBeenCalledWith('11');
    expect(chrome.bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: '1', title: expect.stringContaining('理书整理') }),
    );
  });

  it('分类带 parentName 时按二级目录写入', async () => {
    const create = chrome.bookmarks.create as ReturnType<typeof vi.fn>;
    await writeOrganized(
      [{ id: 'a', title: 'A', url: 'https://a.example/' }],
      [{ name: 'TypeScript', parentName: '工程开发', description: 'TS 文档' }],
      [{ bookmarkId: 'a', category: 'TypeScript', confidence: 0.9 }],
      undefined,
      { hierarchyMode: 'auto', hierarchyThreshold: 30 },
    );
    const createdTitles = create.mock.calls.map(([details]) => (details as chrome.bookmarks.CreateDetails).title);

    expect(createdTitles).toContain('工程开发');
    expect(createdTitles).toContain('TypeScript');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'A', url: 'https://a.example/' }));
  });

  it('收到停止信号后不继续写入后续书签', async () => {
    const controller = new AbortController();
    const create = chrome.bookmarks.create as ReturnType<typeof vi.fn>;
    let createdId = 30;
    create.mockImplementation(async (details: chrome.bookmarks.CreateDetails) => {
      if (details.url === 'https://a.example/') controller.abort();
      return { id: String((createdId += 1)), ...details };
    });

    await expect(
      writeOrganized(
        [
          { id: 'a', title: 'A', url: 'https://a.example/' },
          { id: 'b', title: 'B', url: 'https://b.example/' },
        ],
        [{ name: '工具', description: '工具站点' }],
        [
          { bookmarkId: 'a', category: '工具', confidence: 0.9 },
          { bookmarkId: 'b', category: '工具', confidence: 0.9 },
        ],
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('整理已停止');

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'A', url: 'https://a.example/' }));
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'B', url: 'https://b.example/' }));
  });
});

describe('shouldUseTwoLevel', () => {
  it('auto 模式下 parentName 或超过阈值会启用二级目录', () => {
    expect(
      shouldUseTwoLevel([{ name: '子类', parentName: '父类', description: '说明' }], {
        hierarchyMode: 'auto',
        hierarchyThreshold: 30,
      }),
    ).toBe(true);
    expect(
      shouldUseTwoLevel(
        Array.from({ length: 31 }, (_, index) => ({ name: `类目 ${index}`, description: '说明' })),
        { hierarchyMode: 'auto', hierarchyThreshold: 30 },
      ),
    ).toBe(true);
  });

  it('flat 模式始终保持一级目录', () => {
    expect(
      shouldUseTwoLevel([{ name: '子类', parentName: '父类', description: '说明' }], {
        hierarchyMode: 'flat',
        hierarchyThreshold: 5,
      }),
    ).toBe(false);
  });
});

describe('removeGeneratedFolder', () => {
  it('只删除理书生成的整理文件夹', async () => {
    const removeTree = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      bookmarks: {
        get: vi.fn(async () => [{ id: 'x', title: '📚 理书整理 2026-06-18' }]),
        removeTree,
      },
    });

    await removeGeneratedFolder('x');

    expect(removeTree).toHaveBeenCalledWith('x');
  });

  it('拒绝删除非理书生成文件夹', async () => {
    vi.stubGlobal('chrome', {
      bookmarks: {
        get: vi.fn(async () => [{ id: 'x', title: '书签栏' }]),
        removeTree: vi.fn(),
      },
    });

    await expect(removeGeneratedFolder('x')).rejects.toThrow('拒绝删除');
  });
});
