import { describe, expect, it } from 'vitest';
import type { FlatBookmark } from '../types';
import { buildBookmarkHealthReport, findDuplicateGroups, normalizeBookmarkUrl } from './health';

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
});
