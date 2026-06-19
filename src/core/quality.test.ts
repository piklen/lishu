import { describe, expect, it } from 'vitest';
import type { Progress } from '../types';
import { buildCategoryQualityReport } from './quality';

function progressOf(partial: Partial<Progress>): Progress {
  return {
    status: 'preview',
    total: 0,
    processed: 0,
    categories: [],
    classifications: [],
    ...partial,
  };
}

describe('buildCategoryQualityReport', () => {
  it('给均衡且高置信度的预览高分', () => {
    const report = buildCategoryQualityReport(
      progressOf({
        total: 4,
        categories: [
          { name: '工程', description: '工程资料' },
          { name: '阅读', description: '阅读资料' },
        ],
        classifications: [
          { bookmarkId: '1', category: '工程', confidence: 0.94 },
          { bookmarkId: '2', category: '工程', confidence: 0.9 },
          { bookmarkId: '3', category: '阅读', confidence: 0.88 },
          { bookmarkId: '4', category: '阅读', confidence: 0.91 },
        ],
      }),
    );

    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.level).toBe('good');
    expect(report.averageConfidence).toBe(0.91);
    expect(report.lowConfidenceCount).toBe(0);
    expect(report.categories.map((category) => category.count)).toEqual([2, 2]);
  });

  it('识别低置信度、未知分类和漏分类', () => {
    const report = buildCategoryQualityReport(
      progressOf({
        total: 5,
        categories: [{ name: '工程', description: '工程资料' }],
        classifications: [
          { bookmarkId: '1', category: '工程', confidence: 0.5 },
          { bookmarkId: '2', category: '不存在', confidence: 0.8 },
          { bookmarkId: '2', category: '工程', confidence: 0.9 },
        ],
      }),
    );

    expect(report.level).not.toBe('good');
    expect(report.lowConfidenceCount).toBe(1);
    expect(report.unknownCategoryCount).toBe(1);
    expect(report.unclassifiedCount).toBe(3);
    expect(report.duplicateClassificationCount).toBe(1);
    expect(report.issues.map((issue) => issue.message).join('\n')).toContain('重复 bookmarkId');
    expect(report.issues.map((issue) => issue.message).join('\n')).toContain('不存在的分类');
  });

  it('标记过大、过小和空分类', () => {
    const report = buildCategoryQualityReport(
      progressOf({
        total: 12,
        categories: [
          { name: '大类', description: '过宽分类' },
          { name: '小类 A', description: '低频分类' },
          { name: '小类 B', description: '低频分类' },
          { name: '小类 C', description: '低频分类' },
          { name: '空类', description: '没有命中' },
        ],
        classifications: [
          ...Array.from({ length: 8 }, (_, index) => ({
            bookmarkId: `big-${index}`,
            category: '大类',
            confidence: 0.9,
          })),
          { bookmarkId: 'small-a', category: '小类 A', confidence: 0.88 },
          { bookmarkId: 'small-b', category: '小类 B', confidence: 0.87 },
          { bookmarkId: 'small-c', category: '小类 C', confidence: 0.86 },
          { bookmarkId: 'small-d', category: '小类 C', confidence: 0.86 },
        ],
      }),
    );

    const big = report.categories.find((category) => category.name === '大类');
    const empty = report.categories.find((category) => category.name === '空类');
    const small = report.categories.find((category) => category.name === '小类 A');

    expect(big?.flags).toContain('过大分类');
    expect(empty?.flags).toContain('空分类');
    expect(small?.flags).toContain('过小分类');
  });
});
