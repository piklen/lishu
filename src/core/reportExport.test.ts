import { describe, expect, it } from 'vitest';
import type { BookmarkHealthReport, DeadLinkReport } from '../types';
import { formatDeadLinkReport, formatDuplicateReport } from './reportExport';

describe('health report export', () => {
  it('格式化完整重复书签报告', () => {
    const report: BookmarkHealthReport = {
      total: 3,
      duplicateBookmarkCount: 2,
      generatedAt: '2026-06-19T13:00:00.000Z',
      duplicateGroups: [
        {
          normalizedUrl: 'https://example.com/docs',
          displayUrl: 'https://example.com/docs?utm_source=feed',
          bookmarks: [
            { id: '1', title: 'Docs', url: 'https://example.com/docs?utm_source=feed', parentPath: 'Dev/Docs' },
            { id: '2', title: 'Docs copy', url: 'https://example.com/docs/' },
          ],
        },
      ],
    };

    const text = formatDuplicateReport(report);
    expect(text).toContain('# 理书重复书签报告');
    expect(text).toContain('重复组: 1');
    expect(text).toContain('涉及书签: 2');
    expect(text).toContain('位置: Dev/Docs');
    expect(text).toContain('URL: https://example.com/docs/');
  });

  it('格式化失效链接报告并区分状态', () => {
    const report: DeadLinkReport = {
      total: 4,
      checked: 3,
      generatedAt: '2026-06-19T13:00:00.000Z',
      deadLinks: [
        {
          bookmark: { id: '1', title: 'Gone', url: 'https://example.com/gone', parentPath: 'Archive' },
          status: 'broken',
          reason: 'HTTP 404',
          httpStatus: 404,
        },
        {
          bookmark: { id: '2', title: '', url: 'https://example.com/timeout' },
          status: 'unverified',
          reason: '请求超时',
          finalUrl: 'https://www.example.com/timeout',
        },
      ],
    };

    const text = formatDeadLinkReport(report);
    expect(text).toContain('# 理书失效链接报告');
    expect(text).toContain('可能失效: 1');
    expect(text).toContain('无法确认: 1');
    expect(text).toContain('状态: 可能失效');
    expect(text).toContain('状态: 无法确认');
    expect(text).toContain('HTTP: 404');
    expect(text).toContain('(无标题)');
    expect(text).toContain('最终 URL: https://www.example.com/timeout');
  });

  it('空报告给出明确结论', () => {
    const duplicateText = formatDuplicateReport({
      total: 1,
      duplicateGroups: [],
      duplicateBookmarkCount: 0,
      generatedAt: '2026-06-19T13:00:00.000Z',
    });
    const deadLinkText = formatDeadLinkReport({
      total: 1,
      checked: 1,
      deadLinks: [],
      generatedAt: '2026-06-19T13:00:00.000Z',
    });

    expect(duplicateText).toContain('未发现重复 URL。');
    expect(deadLinkText).toContain('未发现可能失效链接。');
  });
});
