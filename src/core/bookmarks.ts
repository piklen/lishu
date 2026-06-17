// chrome.bookmarks 读取扁平化 + 非破坏式写入
import type { FlatBookmark, Category, Classification } from '../types';

const OTHER = '其他';

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
    const b = byId.get(cls.bookmarkId);
    if (!b) continue;
    (buckets.get(cls.category) ?? buckets.get(OTHER)!).push(b);
    classified.add(b.id);
  }
  // 完全没被 LLM 判到的,兜底进「其他」
  for (const b of bookmarks) if (!classified.has(b.id)) buckets.get(OTHER)!.push(b);
  return buckets;
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
): Promise<string> {
  const buckets = bucketByCategory(bookmarks, categories, classifications);
  // 不指定 parentId → 默认落在「其他书签」,不动书签栏
  const root = await chrome.bookmarks.create({ title: `📚 理书整理 ${dateStamp()}` });
  for (const [catName, items] of buckets) {
    if (items.length === 0) continue;
    const folder = await chrome.bookmarks.create({ parentId: root.id, title: catName });
    for (const b of items) {
      await chrome.bookmarks.create({ parentId: folder.id, title: b.title, url: b.url });
    }
  }
  return root.id;
}
