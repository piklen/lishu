import { describe, expect, it } from 'vitest';
import { buildCategoryQualityReport } from './quality';
import { buildDemoProgress } from './demo';

describe('buildDemoProgress', () => {
  it('生成无需真实书签或 LLM 的预览态示例', () => {
    const progress = buildDemoProgress();
    const ids = new Set(progress.classifications.map((classification) => classification.bookmarkId));

    expect(progress.status).toBe('preview');
    expect(progress.total).toBeGreaterThan(progress.classifications.length);
    expect(ids.size).toBe(progress.classifications.length);
    expect(progress.rootFolderId).toBeUndefined();
  });

  it('示例数据能触发质量预检提示', () => {
    const report = buildCategoryQualityReport(buildDemoProgress());

    expect(report.score).toBeGreaterThan(60);
    expect(report.lowConfidenceCount).toBeGreaterThan(0);
    expect(report.unclassifiedCount).toBe(1);
    expect(report.issues.map((issue) => issue.message).join('\n')).toContain('置信度低于');
  });
});
