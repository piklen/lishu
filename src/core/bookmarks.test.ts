import { describe, expect, it } from 'vitest';
import type { Category, Classification, FlatBookmark } from '../types';
import { bucketByCategory, flattenTree } from './bookmarks';

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
});
