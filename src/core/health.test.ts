import { describe, expect, it } from 'vitest';
import type { FlatBookmark } from '../types';
import {
  buildBookmarkHealthReport,
  buildDeadLinkReport,
  classifyDeadLinkStatus,
  findDuplicateGroups,
  normalizeBookmarkUrl,
} from './health';

describe('bookmark health report', () => {
  it('归一化 URL 时忽略 hash、末尾斜杠和常见追踪参数', () => {
    expect(normalizeBookmarkUrl('HTTPS://Example.com/docs/?b=2&utm_source=x&a=1#intro')).toBe(
      'https://example.com/docs?a=1&b=2',
    );
    expect(normalizeBookmarkUrl('https://example.com/docs/')).toBe('https://example.com/docs');
  });

  it('按归一化 URL 找出重复书签组', () => {
    const bookmarks: FlatBookmark[] = [
      { id: '1', title: 'Docs', url: 'https://example.com/docs?utm_source=feed' },
      { id: '2', title: 'Docs copy', url: 'https://example.com/docs/' },
      { id: '3', title: 'App', url: 'https://example.com/app' },
      { id: '4', title: 'App copy', url: 'https://example.com/app#read' },
      { id: '5', title: 'Other', url: 'https://example.com/other' },
    ];

    const groups = findDuplicateGroups(bookmarks);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.bookmarks.map((bookmark) => bookmark.id))).toEqual([
      ['3', '4'],
      ['1', '2'],
    ]);
  });

  it('构建只读体检报告', () => {
    const bookmarks: FlatBookmark[] = [
      { id: '1', title: 'One', url: 'https://example.com/a' },
      { id: '2', title: 'Two', url: 'https://example.com/a/' },
      { id: '3', title: 'Three', url: 'https://example.com/b' },
    ];

    const report = buildBookmarkHealthReport(bookmarks);

    expect(report.total).toBe(3);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateBookmarkCount).toBe(2);
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  it('区分明确失效、无法确认和无需报告的 HTTP 状态', () => {
    expect(classifyDeadLinkStatus(200)).toBeNull();
    expect(classifyDeadLinkStatus(301)).toBeNull();
    expect(classifyDeadLinkStatus(401)).toBeNull();
    expect(classifyDeadLinkStatus(403)).toBeNull();
    expect(classifyDeadLinkStatus(404)).toBe('broken');
    expect(classifyDeadLinkStatus(410)).toBe('broken');
    expect(classifyDeadLinkStatus(429)).toBe('unverified');
    expect(classifyDeadLinkStatus(503)).toBe('unverified');
  });

  it('联网失效检测只检查 http(s) 书签并报告可疑结果', async () => {
    const bookmarks: FlatBookmark[] = [
      { id: '1', title: 'OK', url: 'https://example.com/ok' },
      { id: '2', title: 'Gone', url: 'https://example.com/gone' },
      { id: '3', title: 'Private', url: 'https://example.com/private' },
      { id: '4', title: 'Local', url: 'chrome://extensions' },
    ];
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/gone')) return new Response(null, { status: 404 });
      if (url.endsWith('/private')) return new Response(null, { status: 403 });
      return new Response(null, { status: 200 });
    };

    const report = await buildDeadLinkReport(bookmarks, { fetchImpl, concurrency: 2, timeoutMs: 1_000 });

    expect(report.total).toBe(4);
    expect(report.checked).toBe(3);
    expect(report.deadLinks).toHaveLength(1);
    expect(report.deadLinks[0]).toMatchObject({
      status: 'broken',
      httpStatus: 404,
      bookmark: { id: '2' },
    });
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  it('HEAD 不被支持时用 GET 兜底', async () => {
    const bookmarks: FlatBookmark[] = [{ id: '1', title: 'Fallback', url: 'https://example.com/fallback' }];
    const methods: string[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'HEAD') return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    };

    const report = await buildDeadLinkReport(bookmarks, { fetchImpl, concurrency: 1, timeoutMs: 1_000 });

    expect(methods).toEqual(['HEAD', 'GET']);
    expect(report.deadLinks).toHaveLength(0);
  });
});
