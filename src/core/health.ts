// 本地书签体检:只读分析,不修改原始书签树
import type { BookmarkHealthReport, DuplicateGroup, FlatBookmark } from '../types';

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ref',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

function normalizePath(pathname: string): string {
  if (pathname === '/') return '';
  return pathname.replace(/\/+$/, '');
}

function normalizedSearchParams(url: URL): string {
  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_'))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    );
  const search = new URLSearchParams(params).toString();
  return search ? `?${search}` : '';
}

export function normalizeBookmarkUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : '';
    if (protocol !== 'http:' && protocol !== 'https:') return rawUrl.trim().toLowerCase();
    return `${protocol}//${host}${port}${normalizePath(url.pathname)}${normalizedSearchParams(url)}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function findDuplicateGroups(bookmarks: FlatBookmark[]): DuplicateGroup[] {
  const groups = new Map<string, FlatBookmark[]>();

  for (const bookmark of bookmarks) {
    const normalizedUrl = normalizeBookmarkUrl(bookmark.url);
    const group = groups.get(normalizedUrl) ?? [];
    group.push(bookmark);
    groups.set(normalizedUrl, group);
  }

  return Array.from(groups, ([normalizedUrl, groupedBookmarks]) => ({
    normalizedUrl,
    displayUrl: groupedBookmarks[0]?.url ?? normalizedUrl,
    bookmarks: groupedBookmarks,
  }))
    .filter((group) => group.bookmarks.length > 1)
    .sort(
      (left, right) =>
        right.bookmarks.length - left.bookmarks.length || left.displayUrl.localeCompare(right.displayUrl),
    );
}

export function buildBookmarkHealthReport(bookmarks: FlatBookmark[]): BookmarkHealthReport {
  const duplicateGroups = findDuplicateGroups(bookmarks);
  return {
    total: bookmarks.length,
    duplicateGroups,
    duplicateBookmarkCount: duplicateGroups.reduce((sum, group) => sum + group.bookmarks.length, 0),
    generatedAt: new Date().toISOString(),
  };
}
