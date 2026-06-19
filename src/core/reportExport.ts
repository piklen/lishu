import type {
  BookmarkHealthReport,
  CategoryQualityCategory,
  CategoryQualityLevel,
  CategoryQualityReport,
  DeadLinkReport,
  DeadLinkResult,
  DuplicateGroup,
  FlatBookmark,
} from '../types';

function bookmarkTitle(bookmark: FlatBookmark): string {
  return bookmark.title.trim() || '(无标题)';
}

function bookmarkPath(bookmark: FlatBookmark): string {
  return bookmark.parentPath ? `\n  位置: ${bookmark.parentPath}` : '';
}

function formatBookmark(bookmark: FlatBookmark): string {
  return `- ${bookmarkTitle(bookmark)}${bookmarkPath(bookmark)}\n  URL: ${bookmark.url}`;
}

function formatDuplicateGroup(group: DuplicateGroup, index: number): string {
  return [
    `## ${index}. ${group.displayUrl}`,
    `归一化 URL: ${group.normalizedUrl}`,
    `副本数: ${group.bookmarks.length}`,
    '',
    ...group.bookmarks.map(formatBookmark),
  ].join('\n');
}

function deadLinkStatusText(result: DeadLinkResult): string {
  return result.status === 'broken' ? '可能失效' : '无法确认';
}

function formatDeadLink(result: DeadLinkResult, index: number): string {
  const lines = [
    `## ${index}. ${bookmarkTitle(result.bookmark)}`,
    `状态: ${deadLinkStatusText(result)}`,
    `原因: ${result.reason}`,
    `URL: ${result.bookmark.url}`,
  ];
  if (result.bookmark.parentPath) lines.push(`位置: ${result.bookmark.parentPath}`);
  if (typeof result.httpStatus === 'number') lines.push(`HTTP: ${result.httpStatus}`);
  if (result.finalUrl && result.finalUrl !== result.bookmark.url) lines.push(`最终 URL: ${result.finalUrl}`);
  return lines.join('\n');
}

export function formatDuplicateReport(report: BookmarkHealthReport): string {
  const lines = [
    '# 理书重复书签报告',
    `生成时间: ${report.generatedAt}`,
    `扫描书签: ${report.total}`,
    `重复组: ${report.duplicateGroups.length}`,
    `涉及书签: ${report.duplicateBookmarkCount}`,
    '',
  ];

  if (report.duplicateGroups.length === 0) {
    lines.push('未发现重复 URL。');
    return lines.join('\n');
  }

  lines.push(report.duplicateGroups.map((group, index) => formatDuplicateGroup(group, index + 1)).join('\n\n'));
  return lines.join('\n');
}

export function formatDeadLinkReport(report: DeadLinkReport): string {
  const brokenCount = report.deadLinks.filter((result) => result.status === 'broken').length;
  const unverifiedCount = report.deadLinks.length - brokenCount;
  const lines = [
    '# 理书失效链接报告',
    `生成时间: ${report.generatedAt}`,
    `总书签: ${report.total}`,
    `已检查 http(s) 书签: ${report.checked}`,
    `可能失效: ${brokenCount}`,
    `无法确认: ${unverifiedCount}`,
    '',
  ];

  if (report.deadLinks.length === 0) {
    lines.push('未发现可能失效链接。');
    return lines.join('\n');
  }

  lines.push(report.deadLinks.map((result, index) => formatDeadLink(result, index + 1)).join('\n\n'));
  return lines.join('\n');
}

function qualityLevelText(level: CategoryQualityLevel): string {
  if (level === 'good') return '稳定';
  if (level === 'review') return '需要复查';
  return '风险较高';
}

function formatPercent(value: number | null): string {
  if (value === null) return '无';
  return `${Math.round(value * 100)}%`;
}

function formatQualityCategory(category: CategoryQualityCategory, index: number): string {
  const lines = [
    `## ${index}. ${category.name}`,
    `书签数: ${category.count}`,
    `占比: ${formatPercent(category.share)}`,
    `平均置信度: ${formatPercent(category.averageConfidence)}`,
    `低置信度: ${category.lowConfidenceCount}`,
  ];
  if (category.flags.length > 0) lines.push(`提示: ${category.flags.join(' / ')}`);
  return lines.join('\n');
}

export function formatCategoryQualityReport(report: CategoryQualityReport): string {
  const lines = [
    '# 理书分类质量报告',
    `质量分: ${report.score}/100 (${qualityLevelText(report.level)})`,
    `总书签: ${report.total}`,
    `已分类: ${report.classifiedCount}`,
    `平均置信度: ${formatPercent(report.averageConfidence)}`,
    `低置信度阈值: ${formatPercent(report.lowConfidenceThreshold)}`,
    `低置信度书签: ${report.lowConfidenceCount}`,
    `未知分类: ${report.unknownCategoryCount}`,
    `漏分类: ${report.unclassifiedCount}`,
    `重复分类结果: ${report.duplicateClassificationCount}`,
    '',
    '## 复查提示',
    ...report.issues.map((issue) => `- [${issue.severity}] ${issue.message}`),
    '',
    '## 分类明细',
    report.categories.map((category, index) => formatQualityCategory(category, index + 1)).join('\n\n'),
  ];

  return lines.join('\n');
}
