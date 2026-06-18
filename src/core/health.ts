// 本地书签体检:只读分析,不修改原始书签树
import type {
  BookmarkHealthReport,
  DeadLinkReport,
  DeadLinkResult,
  DeadLinkStatus,
  DuplicateGroup,
  FlatBookmark,
} from '../types';

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
const DEFAULT_DEAD_LINK_TIMEOUT_MS = 8_000;
const DEFAULT_DEAD_LINK_CONCURRENCY = 6;
const BROKEN_HTTP_STATUSES = new Set([400, 404, 410, 451]);
const NOT_DEAD_HTTP_STATUSES = new Set([401, 403]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DeadLinkCheckOptions {
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: FetchLike;
}

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

function isHttpBookmark(bookmark: FlatBookmark): boolean {
  try {
    const url = new URL(bookmark.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function classifyDeadLinkStatus(httpStatus: number): DeadLinkStatus | null {
  if (httpStatus >= 200 && httpStatus < 400) return null;
  if (NOT_DEAD_HTTP_STATUSES.has(httpStatus)) return null;
  if (BROKEN_HTTP_STATUSES.has(httpStatus) || (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429)) {
    return 'broken';
  }
  return 'unverified';
}

function resultFromResponse(bookmark: FlatBookmark, response: Response): DeadLinkResult | null {
  const status = classifyDeadLinkStatus(response.status);
  if (!status) return null;
  return {
    bookmark,
    status,
    reason: status === 'broken' ? `HTTP ${response.status}` : `无法确认:HTTP ${response.status}`,
    httpStatus: response.status,
    finalUrl: response.url || bookmark.url,
  };
}

function resultFromError(bookmark: FlatBookmark, error: unknown): DeadLinkResult {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return {
    bookmark,
    status: 'unverified',
    reason: name === 'AbortError' ? '请求超时' : `网络错误:${message}`,
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method,
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkBookmarkLink(
  bookmark: FlatBookmark,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<DeadLinkResult | null> {
  try {
    const response = await fetchWithTimeout(fetchImpl, bookmark.url, 'HEAD', timeoutMs);
    if (response.status !== 405 && response.status !== 501) return resultFromResponse(bookmark, response);
  } catch {
    // 有些站点不接受 HEAD,用 GET 做一次兜底,仍受同一个超时限制。
  }

  try {
    const response = await fetchWithTimeout(fetchImpl, bookmark.url, 'GET', timeoutMs);
    return resultFromResponse(bookmark, response);
  } catch (error) {
    return resultFromError(bookmark, error);
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );

  return results;
}

export async function buildDeadLinkReport(
  bookmarks: FlatBookmark[],
  options: DeadLinkCheckOptions = {},
): Promise<DeadLinkReport> {
  const checkableBookmarks = bookmarks.filter(isHttpBookmark);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_DEAD_LINK_TIMEOUT_MS);
  const concurrency = Math.max(1, Math.min(10, Math.floor(options.concurrency ?? DEFAULT_DEAD_LINK_CONCURRENCY)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const results = await mapConcurrent(checkableBookmarks, concurrency, (bookmark) =>
    checkBookmarkLink(bookmark, fetchImpl, timeoutMs),
  );
  const deadLinks = results
    .filter((result): result is DeadLinkResult => !!result)
    .sort(
      (left, right) =>
        left.status.localeCompare(right.status) ||
        (left.httpStatus ?? 0) - (right.httpStatus ?? 0) ||
        left.bookmark.title.localeCompare(right.bookmark.title, 'zh-CN'),
    );

  return {
    total: bookmarks.length,
    checked: checkableBookmarks.length,
    deadLinks,
    generatedAt: new Date().toISOString(),
  };
}
