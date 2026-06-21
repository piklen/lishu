// chrome.bookmarks 读取扁平化 + 非破坏式写入
import type { FlatBookmark, Category, Classification, HierarchyMode } from '../types';

const OTHER = '其他';
const GENERATED_ROOT_PREFIX = '📚 理书整理';
const DEFAULT_UNGROUPED_PARENT = '未分组分类';
const BOOKMARKS_BAR_ID = '1';

export interface WriteOrganizedOptions {
  hierarchyMode?: HierarchyMode;
  hierarchyThreshold?: number;
  signal?: AbortSignal;
}

/** 递归扁平化书签树,只收集有 url 的叶子节点 */
export function flattenTree(nodes: chrome.bookmarks.BookmarkTreeNode[]): FlatBookmark[] {
  const out: FlatBookmark[] = [];
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string): void => {
    if (node.url) {
      out.push({ id: node.id, title: node.title || node.url, url: node.url, parentPath: path });
    }
    if (node.children) {
      const childPath = node.title ? (path ? `${path}/${node.title}` : node.title) : path;
      for (const c of node.children) walk(c, childPath);
    }
  };
  for (const n of nodes) walk(n, '');
  return out;
}

/** 读取全部书签并扁平化 */
export async function getAllBookmarks(): Promise<FlatBookmark[]> {
  return flattenTree(await chrome.bookmarks.getTree());
}

/** Chrome 固定把书签栏作为 root 的第一个子节点;id=1 是 Chromium 约定,作为兜底。 */
export function findBookmarksBarId(nodes: chrome.bookmarks.BookmarkTreeNode[]): string {
  const root = nodes[0];
  return root?.children?.find((node) => node.id === BOOKMARKS_BAR_ID)?.id ?? root?.children?.[0]?.id ?? BOOKMARKS_BAR_ID;
}

async function getBookmarksBarId(): Promise<string> {
  return findBookmarksBarId(await chrome.bookmarks.getTree());
}

/** 把 classifications 按类目分桶(未知类目 / 漏判归「其他」) */
export function bucketByCategory(
  bookmarks: FlatBookmark[],
  categories: Category[],
  classifications: Classification[],
): Map<string, FlatBookmark[]> {
  const byId = new Map(bookmarks.map((b) => [b.id, b]));
  const buckets = new Map<string, FlatBookmark[]>();
  for (const c of categories) buckets.set(c.name, []);
  buckets.set(OTHER, []);
  const classified = new Set<string>();
  for (const cls of classifications) {
    if (classified.has(cls.bookmarkId)) continue;
    const b = byId.get(cls.bookmarkId);
    if (!b) continue;
    (buckets.get(cls.category) ?? buckets.get(OTHER)!).push(b);
    classified.add(b.id);
  }
  // 完全没被 LLM 判到的,兜底进「其他」
  for (const b of bookmarks) if (!classified.has(b.id)) buckets.get(OTHER)!.push(b);
  return buckets;
}

export function shouldUseTwoLevel(categories: Category[], options: WriteOrganizedOptions = {}): boolean {
  const mode = options.hierarchyMode ?? 'auto';
  if (mode === 'flat') return false;
  if (mode === 'two-level') return true;
  const threshold = Math.max(1, Math.floor(options.hierarchyThreshold ?? 30));
  return categories.length > threshold || categories.some((category) => !!category.parentName?.trim());
}

function parentNameOf(category: Category): string {
  return category.parentName?.trim() || DEFAULT_UNGROUPED_PARENT;
}

function throwIfStopped(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('整理已停止');
}

async function createBookmarks(parentId: string, bookmarks: FlatBookmark[], signal?: AbortSignal): Promise<void> {
  for (const b of bookmarks) {
    throwIfStopped(signal);
    await chrome.bookmarks.create({ parentId, title: b.title, url: b.url });
  }
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 非破坏式写入:新建顶层文件夹 → 按类目建子夹 → 放书签副本。
 * 只 create,绝不 remove/update 原书签。返回新建顶层文件夹 id。
 */
export async function writeOrganized(
  bookmarks: FlatBookmark[],
  categories: Category[],
  classifications: Classification[],
  onRootCreated?: (rootFolderId: string) => void | Promise<void>,
  options: WriteOrganizedOptions = {},
): Promise<string> {
  throwIfStopped(options.signal);
  const buckets = bucketByCategory(bookmarks, categories, classifications);
  // 输出根目录放到书签栏,让整理结果直接出现在用户最常用的位置。
  const root = await chrome.bookmarks.create({
    parentId: await getBookmarksBarId(),
    title: `${GENERATED_ROOT_PREFIX} ${dateStamp()}`,
  });
  await onRootCreated?.(root.id);
  if (shouldUseTwoLevel(categories, options)) {
    const parentFolders = new Map<string, string>();
    for (const category of categories) {
      throwIfStopped(options.signal);
      const items = buckets.get(category.name) ?? [];
      if (items.length === 0) continue;
      const parentName = parentNameOf(category);
      let parentId = parentFolders.get(parentName);
      if (!parentId) {
        const parentFolder = await chrome.bookmarks.create({ parentId: root.id, title: parentName });
        parentId = parentFolder.id;
        parentFolders.set(parentName, parentId);
      }
      const childFolder = await chrome.bookmarks.create({ parentId, title: category.name });
      await createBookmarks(childFolder.id, items, options.signal);
    }
    const otherItems = buckets.get(OTHER) ?? [];
    if (otherItems.length > 0) {
      const otherFolder = await chrome.bookmarks.create({ parentId: root.id, title: OTHER });
      await createBookmarks(otherFolder.id, otherItems, options.signal);
    }
    return root.id;
  }

  for (const [catName, items] of buckets) {
    throwIfStopped(options.signal);
    if (items.length === 0) continue;
    const folder = await chrome.bookmarks.create({ parentId: root.id, title: catName });
    await createBookmarks(folder.id, items, options.signal);
  }
  return root.id;
}

/** 只允许删除理书生成的顶层整理结果,避免误删用户原始书签树 */
export async function removeGeneratedFolder(rootFolderId: string): Promise<void> {
  const nodes = await chrome.bookmarks.get(rootFolderId);
  const root = nodes[0];
  if (!root || root.url || !root.title.startsWith(GENERATED_ROOT_PREFIX)) {
    throw new Error('拒绝删除:目标不是理书生成的整理文件夹');
  }
  await chrome.bookmarks.removeTree(rootFolderId);
}
