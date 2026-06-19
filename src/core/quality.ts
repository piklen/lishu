// 分类质量评估:只读 progress,不触发网络或书签写入
import type {
  CategoryQualityCategory,
  CategoryQualityLevel,
  CategoryQualityReport,
  CategoryQualitySeverity,
  Progress,
} from '../types';

const LOW_CONFIDENCE_THRESHOLD = 0.65;
const OVERBROAD_SHARE = 0.55;
const TINY_CATEGORY_LIMIT = 1;

interface MutableCategoryStat {
  name: string;
  count: number;
  confidenceSum: number;
  confidenceCount: number;
  lowConfidenceCount: number;
}

type QualityInput = Pick<Progress, 'total' | 'categories' | 'classifications'>;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundShare(value: number): number {
  return Number(value.toFixed(4));
}

function roundConfidence(value: number): number {
  return Number(value.toFixed(2));
}

function levelOf(score: number): CategoryQualityLevel {
  if (score >= 80) return 'good';
  if (score >= 60) return 'review';
  return 'poor';
}

function pushIssue(
  issues: CategoryQualityReport['issues'],
  severity: CategoryQualitySeverity,
  message: string,
): void {
  issues.push({ severity, message });
}

function toPublicStat(stat: MutableCategoryStat, total: number): CategoryQualityCategory {
  const averageConfidence =
    stat.confidenceCount > 0 ? roundConfidence(stat.confidenceSum / stat.confidenceCount) : null;
  const share = total > 0 ? roundShare(stat.count / total) : 0;
  const flags: string[] = [];

  if (stat.count === 0) flags.push('空分类');
  if (stat.count > 0 && stat.count <= TINY_CATEGORY_LIMIT && total >= 10) flags.push('过小分类');
  if (share >= OVERBROAD_SHARE && total >= 10) flags.push('过大分类');
  if (averageConfidence !== null && averageConfidence < 0.7) flags.push('平均置信度低');
  if (stat.lowConfidenceCount > 0) flags.push('含低置信度');

  return {
    name: stat.name,
    count: stat.count,
    share,
    averageConfidence,
    lowConfidenceCount: stat.lowConfidenceCount,
    flags,
  };
}

export function buildCategoryQualityReport(input: QualityInput): CategoryQualityReport {
  const total = Math.max(0, Math.floor(input.total));
  const categoryStats = new Map<string, MutableCategoryStat>();
  const categoryNames = new Set<string>();

  for (const category of input.categories) {
    categoryNames.add(category.name);
    if (!categoryStats.has(category.name)) {
      categoryStats.set(category.name, {
        name: category.name,
        count: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        lowConfidenceCount: 0,
      });
    }
  }

  let unknownCategoryCount = 0;
  let duplicateClassificationCount = 0;
  let lowConfidenceCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  const classifiedBookmarkIds = new Set<string>();

  for (const classification of input.classifications) {
    if (classifiedBookmarkIds.has(classification.bookmarkId)) {
      duplicateClassificationCount += 1;
      continue;
    }
    classifiedBookmarkIds.add(classification.bookmarkId);

    const confidence = clamp01(classification.confidence);
    confidenceSum += confidence;
    confidenceCount += 1;
    if (confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidenceCount += 1;

    const stat = categoryStats.get(classification.category);
    if (!stat || !categoryNames.has(classification.category)) {
      unknownCategoryCount += 1;
      continue;
    }

    stat.count += 1;
    stat.confidenceSum += confidence;
    stat.confidenceCount += 1;
    if (confidence < LOW_CONFIDENCE_THRESHOLD) stat.lowConfidenceCount += 1;
  }

  const classifiedCount = classifiedBookmarkIds.size;
  const unclassifiedCount = Math.max(0, total - classifiedCount);
  const categories = Array.from(categoryStats.values())
    .map((stat) => toPublicStat(stat, total))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'));
  const emptyCategoryCount = categories.filter((category) => category.count === 0).length;
  const tinyCategoryCount = categories.filter(
    (category) => category.count > 0 && category.count <= TINY_CATEGORY_LIMIT,
  ).length;
  const largestShare = categories[0]?.share ?? 0;
  const lowConfidenceRate = classifiedCount > 0 ? lowConfidenceCount / classifiedCount : 0;
  const coverageProblemRate = total > 0 ? (unknownCategoryCount + unclassifiedCount) / total : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          lowConfidenceRate * 30 -
          coverageProblemRate * 35 -
          Math.min(20, duplicateClassificationCount * 5) -
          Math.min(14, emptyCategoryCount * 3) -
          (largestShare > OVERBROAD_SHARE ? Math.min(18, (largestShare - OVERBROAD_SHARE) * 55) : 0) -
          (tinyCategoryCount >= 3 && tinyCategoryCount / Math.max(1, categories.length) > 0.35 ? 8 : 0),
      ),
    ),
  );

  const issues: CategoryQualityReport['issues'] = [];
  if (total === 0) {
    pushIssue(issues, 'info', '没有可评估的书签。');
  }
  if (duplicateClassificationCount > 0) {
    pushIssue(issues, 'danger', `模型返回了 ${duplicateClassificationCount} 条重复 bookmarkId,建议重新生成预览。`);
  }
  if (unknownCategoryCount > 0) {
    pushIssue(issues, 'warning', `${unknownCategoryCount} 个书签被归入不存在的分类,写入时会落到其他。`);
  }
  if (unclassifiedCount > 0) {
    pushIssue(issues, 'warning', `${unclassifiedCount} 个书签没有分类结果,写入时会落到其他。`);
  }
  if (lowConfidenceCount > 0) {
    pushIssue(issues, 'warning', `${lowConfidenceCount} 个书签置信度低于 ${Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}%。`);
  }
  if (categories[0] && largestShare > OVERBROAD_SHARE && total >= 10) {
    pushIssue(issues, 'warning', `最大分类「${categories[0].name}」占比 ${Math.round(largestShare * 100)}%,可能过宽。`);
  }
  if (emptyCategoryCount > 0) {
    pushIssue(issues, 'info', `${emptyCategoryCount} 个分类没有命中书签,可以在确认前合并或改名。`);
  }
  if (tinyCategoryCount >= 3 && tinyCategoryCount / Math.max(1, categories.length) > 0.35) {
    pushIssue(issues, 'info', `${tinyCategoryCount} 个分类只有 1 个书签,可能分类过细。`);
  }
  if (issues.length === 0) {
    pushIssue(issues, 'info', '分类分布和置信度看起来稳定,仍建议先抽查大类和低频类。');
  }

  return {
    total,
    classifiedCount,
    score,
    level: levelOf(score),
    averageConfidence: confidenceCount > 0 ? roundConfidence(confidenceSum / confidenceCount) : null,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
    lowConfidenceCount,
    unknownCategoryCount,
    unclassifiedCount,
    duplicateClassificationCount,
    categories,
    issues,
  };
}
