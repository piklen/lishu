// popup 逻辑:配置、触发、进度展示
import type {
  AppConfig,
  BookmarkHealthReport,
  BookmarkCategoryOverride,
  CategoryQualityReport,
  CategoryRename,
  DeadLinkReport,
  DeadLinkResult,
  DuplicateGroup,
  EnrichMode,
  FlatBookmark,
  HierarchyMode,
  LlmHealthCheckResult,
  LlmProtocol,
  Message,
  Progress,
  RunStatus,
} from '../types';
import { buildDemoProgress } from '../core/demo';
import { formatCategoryQualityReport, formatDeadLinkReport, formatDuplicateReport } from '../core/reportExport';
import { buildCategoryQualityReport } from '../core/quality';
import { loadConfig, loadProgress, normalizeConfig, saveConfig } from '../core/storage';
import { getAllBookmarks } from '../core/bookmarks';

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '待命',
  scanning: '正在扫描书签',
  categorizing: '正在生成分类体系',
  classifying: '正在分批归类',
  preview: '等待确认写入',
  writing: '正在写入整理副本',
  stopped: '整理已停止',
  done: '整理完成',
  error: '整理失败',
};

const OTHER_CATEGORY = '其他';
const MAX_DUPLICATE_GROUPS = 6;
const MAX_BOOKMARKS_PER_GROUP = 4;
const MAX_DEAD_LINKS = 8;
const STALE_RUNNING_MS = 120_000;

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少页面元素: ${id}`);
  return el as T;
}

const endpointInput = mustGet<HTMLInputElement>('endpoint');
const apiKeyInput = mustGet<HTMLInputElement>('apiKey');
const modelInput = mustGet<HTMLInputElement>('model');
const protocolSelect = mustGet<HTMLSelectElement>('protocol');
const enrichModeSelect = mustGet<HTMLSelectElement>('enrichMode');
const batchSizeInput = mustGet<HTMLInputElement>('batchSize');
const hierarchyModeSelect = mustGet<HTMLSelectElement>('hierarchyMode');
const hierarchyThresholdInput = mustGet<HTMLInputElement>('hierarchyThreshold');
const apiKeyHintEl = mustGet<HTMLSpanElement>('apiKeyHint');
const saveButton = mustGet<HTMLButtonElement>('save');
const demoPreviewButton = mustGet<HTMLButtonElement>('demoPreview');
const startButton = mustGet<HTMLButtonElement>('start');
const confirmWriteButton = mustGet<HTMLButtonElement>('confirmWrite');
const analyzeBookmarksButton = mustGet<HTMLButtonElement>('analyzeBookmarks');
const checkDeadLinksButton = mustGet<HTMLButtonElement>('checkDeadLinks');
const copyHealthReportButton = mustGet<HTMLButtonElement>('copyHealthReport');
const copyQualityReportButton = mustGet<HTMLButtonElement>('copyQualityReport');
const resetButton = mustGet<HTMLButtonElement>('reset');
const deleteOutputButton = mustGet<HTMLButtonElement>('deleteOutput');
const toastEl = mustGet<HTMLDivElement>('toast');
const configStatusEl = mustGet<HTMLDivElement>('configStatus');
const modelHealthEl = mustGet<HTMLDivElement>('modelHealth');
const modeBadgeEl = mustGet<HTMLDivElement>('modeBadge');
const progressResumeEl = mustGet<HTMLDivElement>('progressResume');
const preflightEl = mustGet<HTMLDivElement>('preflight');
const statusEl = mustGet<HTMLDivElement>('status');
const barFill = mustGet<HTMLDivElement>('barFill');
const previewEl = mustGet<HTMLDivElement>('preview');
const healthStatusEl = mustGet<HTMLDivElement>('healthStatus');
const healthReportEl = mustGet<HTMLDivElement>('healthReport');

interface ActionResponse {
  ok: boolean;
  progress?: Progress;
  health?: LlmHealthCheckResult;
  report?: BookmarkHealthReport;
  deadLinkReport?: DeadLinkReport;
  error?: string;
}

interface PreviewRow {
  name: string;
  parentName?: string;
  count: number;
  editable: boolean;
  averageConfidence: number | null;
  lowConfidenceCount: number;
  flags: string[];
}

let latestHealthReportText = '';
let latestHealthReportContainsFullUrls = false;
let latestQualityReportText = '';
let demoPreviewActive = false;
let savedApiKeyValue = '';
let pendingPreflightKey = '';
let lastRenderedProgress: Progress | null = null;
let saveFeedbackTimer: number | undefined;
let configStatusTimer: number | undefined;
let toastTimer: number | undefined;
let progressPollTimer: number | undefined;
let initialModelHealthCheckAttempted = false;
let modelHealthInFlight = false;
let modelHealthPromise: Promise<LlmHealthCheckResult> | null = null;
let modelHealthPromiseKey = '';

interface PreflightInfo {
  key: string;
  bookmarkCount: number;
  endpointOrigin: string;
  model: string;
  batchSize: number;
  estimatedBatches: number;
  hierarchyText: string;
}

function readForm(): AppConfig {
  return normalizeConfig({
    llm: {
      protocol: protocolSelect.value as LlmProtocol,
      endpoint: endpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
    },
    enrichMode: enrichModeSelect.value as EnrichMode,
    batchSize: Number(batchSizeInput.value),
    hierarchyMode: hierarchyModeSelect.value as HierarchyMode,
    hierarchyThreshold: Number(hierarchyThresholdInput.value),
  });
}

function fillForm(config: AppConfig): void {
  protocolSelect.value = config.llm.protocol;
  endpointInput.value = config.llm.endpoint;
  apiKeyInput.value = config.llm.apiKey;
  modelInput.value = config.llm.model;
  enrichModeSelect.value = config.enrichMode;
  batchSizeInput.value = String(config.batchSize);
  hierarchyModeSelect.value = config.hierarchyMode;
  hierarchyThresholdInput.value = String(config.hierarchyThreshold);
  savedApiKeyValue = config.llm.apiKey;
  updateApiKeyHint();
  updateProtocolHints();
}

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  if (toastTimer) window.clearTimeout(toastTimer);
  toastEl.className = kind === 'error' ? 'toast error' : 'toast';
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2400);
}

function setConfigStatus(message: string, state: 'idle' | 'saved' | 'error' = 'idle'): void {
  if (configStatusTimer) window.clearTimeout(configStatusTimer);
  configStatusEl.className = ['config-status', state === 'idle' ? '' : state].filter(Boolean).join(' ');
  configStatusEl.textContent = message;
  configStatusEl.hidden = false;
}

function hideConfigStatusAfter(ms: number): void {
  if (configStatusTimer) window.clearTimeout(configStatusTimer);
  configStatusTimer = window.setTimeout(() => {
    configStatusEl.hidden = true;
    configStatusEl.textContent = '';
    configStatusEl.className = 'config-status';
  }, ms);
}

function setModelHealthStatus(
  message: string,
  state: 'pending' | 'checking' | 'ok' | 'error' = 'pending',
): void {
  modelHealthEl.className = ['model-health', state].join(' ');
  modelHealthEl.textContent = message;
  modelHealthEl.hidden = false;
}

function resetSaveButtonSoon(): void {
  if (saveFeedbackTimer) window.clearTimeout(saveFeedbackTimer);
  saveFeedbackTimer = window.setTimeout(() => {
    saveButton.disabled = false;
    saveButton.classList.remove('saved');
    saveButton.textContent = '保存配置';
  }, 1600);
}

function updateProtocolHints(): void {
  if (protocolSelect.value === 'anthropic') {
    endpointInput.placeholder = 'https://api.anthropic.com/v1/messages';
    apiKeyInput.placeholder = 'sk-ant-...';
    modelInput.placeholder = 'claude-...';
    return;
  }
  endpointInput.placeholder = 'https://api.openai.com/v1';
  apiKeyInput.placeholder = 'sk-...';
  modelInput.placeholder = 'gpt-4o-mini / deepseek-v4-flash';
}

function updateApiKeyHint(): void {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyHintEl.textContent = '未填写 API Key';
    return;
  }
  apiKeyHintEl.textContent = apiKey === savedApiKeyValue ? 'API Key 已保存' : 'API Key 待保存';
}

function clearPreflight(): void {
  pendingPreflightKey = '';
  preflightEl.hidden = true;
  preflightEl.replaceChildren();
}

function clearValidationState(): void {
  endpointInput.classList.remove('invalid');
  apiKeyInput.classList.remove('invalid');
  modelInput.classList.remove('invalid');
}

function validateConfigForStart(config: AppConfig): void {
  clearValidationState();
  const missing: string[] = [];
  const checks: Array<[HTMLInputElement, string, string]> = [
    [endpointInput, 'Endpoint', config.llm.endpoint],
    [apiKeyInput, 'API Key', config.llm.apiKey],
    [modelInput, 'Model', config.llm.model],
  ];
  for (const [input, label, value] of checks) {
    if (!value) {
      input.classList.add('invalid');
      missing.push(label);
    }
  }
  if (missing.length > 0) throw new Error(`请先填写 ${missing.join(' / ')}`);
}

function hasCompleteLlmConfig(config: AppConfig): boolean {
  return !!config.llm.endpoint && !!config.llm.apiKey && !!config.llm.model;
}

function endpointOrigin(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Endpoint 必须是完整的 http(s) 地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Endpoint 必须使用 http 或 https');
  }
  return url.origin;
}

function hierarchySummary(config: AppConfig): string {
  if (config.hierarchyMode === 'flat') return '始终一级目录';
  if (config.hierarchyMode === 'two-level') return '始终二级目录';
  return `自动,超过 ${config.hierarchyThreshold} 类启用二级目录`;
}

function preflightKey(config: AppConfig, bookmarkCount: number, endpointOriginValue: string): string {
  return [
    endpointOriginValue,
    config.llm.model,
    config.batchSize,
    bookmarkCount,
    config.enrichMode,
    config.hierarchyMode,
    config.hierarchyThreshold,
  ].join('|');
}

async function buildPreflightInfo(config: AppConfig): Promise<PreflightInfo> {
  const bookmarks = await getAllBookmarks();
  const endpointOriginValue = endpointOrigin(config.llm.endpoint);
  const bookmarkCount = bookmarks.length;
  return {
    key: preflightKey(config, bookmarkCount, endpointOriginValue),
    bookmarkCount,
    endpointOrigin: endpointOriginValue,
    model: config.llm.model,
    batchSize: config.batchSize,
    estimatedBatches: Math.ceil(bookmarkCount / Math.max(1, config.batchSize)),
    hierarchyText: hierarchySummary(config),
  };
}

function renderPreflight(info: PreflightInfo): void {
  preflightEl.replaceChildren();
  const title = document.createElement('div');
  title.className = 'preflight-title';
  title.textContent = '确认真实整理';
  const grid = document.createElement('dl');
  grid.className = 'preflight-grid';
  const rows: Array<[string, string]> = [
    ['发送内容', `${info.bookmarkCount} 个书签标题和 URL`],
    ['LLM endpoint', info.endpointOrigin],
    ['模型', info.model],
    ['批量', `${info.batchSize} 个/批,约 ${info.estimatedBatches} 批`],
    ['写入结构', info.hierarchyText],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    grid.append(dt, dd);
  }
  preflightEl.append(title, grid);
  preflightEl.hidden = false;
}

function setModeBadge(kind: 'real' | 'demo' | 'running' | 'paused' | 'preview' | 'done'): void {
  modeBadgeEl.className = ['mode-badge', kind === 'real' || kind === 'done' ? '' : kind].filter(Boolean).join(' ');
  if (kind === 'demo') modeBadgeEl.textContent = '示例模式';
  else if (kind === 'running') modeBadgeEl.textContent = '真实整理中';
  else if (kind === 'paused') modeBadgeEl.textContent = '后台已暂停';
  else if (kind === 'preview') modeBadgeEl.textContent = '真实预览';
  else if (kind === 'done') modeBadgeEl.textContent = '整理完成';
  else modeBadgeEl.textContent = '真实模式';
}

function isRunningStatus(progress: Progress | null): boolean {
  return !!progress && ['scanning', 'categorizing', 'classifying', 'writing'].includes(progress.status);
}

function isStaleRunningProgress(progress: Progress | null): boolean {
  if (!progress || !isRunningStatus(progress)) return false;
  const timestamp =
    progress.runMeta?.heartbeatAt ?? progress.runMeta?.currentBatchStartedAt ?? progress.runMeta?.startedAt;
  if (!timestamp) return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && Date.now() - time > STALE_RUNNING_MS;
}

function isRunning(progress: Progress | null): boolean {
  return isRunningStatus(progress) && !isStaleRunningProgress(progress);
}

function percentOf(progress: Progress | null): number {
  if (!progress) return 0;
  if (progress.status === 'done') return 100;
  if (progress.status === 'writing') return 96;
  if (progress.status === 'preview') return 95;
  if (progress.total > 0) return Math.min(95, Math.round((progress.processed / progress.total) * 100));
  if (progress.status === 'categorizing') return 5;
  if (progress.status === 'scanning') return 2;
  return 0;
}

function previewRows(progress: Progress, qualityReport: CategoryQualityReport): PreviewRow[] {
  const categoryNames = new Set(progress.categories.map((category) => category.name));
  const counts = new Map(progress.categories.map((category) => [category.name, 0]));
  const qualityByName = new Map(qualityReport.categories.map((category) => [category.name, category]));
  const seenBookmarkIds = new Set<string>();
  let otherCount = 0;

  for (const classification of progress.classifications) {
    if (seenBookmarkIds.has(classification.bookmarkId)) continue;
    seenBookmarkIds.add(classification.bookmarkId);
    if (categoryNames.has(classification.category)) {
      counts.set(classification.category, (counts.get(classification.category) ?? 0) + 1);
    } else {
      otherCount += 1;
    }
  }

  const unclassifiedCount = Math.max(0, progress.total - seenBookmarkIds.size);
  otherCount += unclassifiedCount;
  if (otherCount > 0 && categoryNames.has(OTHER_CATEGORY)) {
    counts.set(OTHER_CATEGORY, (counts.get(OTHER_CATEGORY) ?? 0) + otherCount);
  }

	  const rows = progress.categories.map((category) => ({
	    name: category.name,
	    parentName: category.parentName,
	    count: counts.get(category.name) ?? 0,
    editable: true,
    averageConfidence: qualityByName.get(category.name)?.averageConfidence ?? null,
    lowConfidenceCount: qualityByName.get(category.name)?.lowConfidenceCount ?? 0,
    flags: qualityByName.get(category.name)?.flags ?? [],
  }));
  if (otherCount > 0 && !categoryNames.has(OTHER_CATEGORY)) {
    rows.push({
      name: OTHER_CATEGORY,
      parentName: undefined,
      count: otherCount,
      editable: false,
      averageConfidence: null,
      lowConfidenceCount: 0,
      flags: ['需复查'],
    });
  }

  return rows
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function qualityLevelText(report: CategoryQualityReport): string {
  if (report.level === 'good') return '稳定';
  if (report.level === 'review') return '需复查';
  return '风险高';
}

function formatPercent(value: number | null): string {
  if (value === null) return '无';
  return `${Math.round(value * 100)}%`;
}

function categoryLabel(name: string, progress: Progress): string {
  const category = progress.categories.find((item) => item.name === name);
  if (!category?.parentName) return name;
  return `${category.parentName} / ${name}`;
}

function bookmarkHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '未知域名';
  }
}

function bookmarksById(progress: Progress): Map<string, FlatBookmark> {
  return new Map((progress.bookmarks ?? []).map((bookmark) => [bookmark.id, bookmark]));
}

function appendQualitySummary(parent: HTMLElement, report: CategoryQualityReport): void {
  const summary = document.createElement('div');
  summary.className = 'quality-summary';

  const title = document.createElement('div');
  title.className = 'quality-title';
  const titleText = document.createElement('span');
  titleText.textContent = '分类质量预检';
  const score = document.createElement('span');
  score.className = `quality-score ${report.level}`;
  score.textContent = `${report.score}/100 · ${qualityLevelText(report)}`;
  title.append(titleText, score);
  summary.append(title);

  const meta = document.createElement('div');
  meta.className = 'quality-meta';
  meta.textContent = `平均置信度 ${formatPercent(report.averageConfidence)} · 低置信度 ${report.lowConfidenceCount} · 需兜底 ${report.unknownCategoryCount + report.unclassifiedCount}`;
  summary.append(meta);

  for (const issue of report.issues.slice(0, 3)) {
    const hint = document.createElement('div');
    hint.className = `quality-hint ${issue.severity}`;
    hint.textContent = issue.message;
    summary.append(hint);
  }

  parent.append(summary);
}

function appendReviewPanel(parent: HTMLElement, progress: Progress, report: CategoryQualityReport): void {
  const details = document.createElement('details');
  details.className = 'review-panel';
  details.open = report.lowConfidenceCount > 0;
  const summary = document.createElement('summary');
  summary.textContent =
    report.lowConfidenceCount > 0 ? `写入前复查 ${report.lowConfidenceCount} 个低置信度书签` : '写入前复查';
  details.append(summary);

  if (report.lowConfidenceCount === 0) {
    const note = document.createElement('div');
    note.className = 'review-note';
    note.textContent = '当前没有低置信度书签。';
    details.append(note);
    parent.append(details);
    return;
  }

  const bookmarkMap = bookmarksById(progress);
  if (bookmarkMap.size === 0) {
    const note = document.createElement('div');
    note.className = 'review-note';
    note.textContent = '这份预览缺少书签快照,请重新生成预览后再逐条复查。';
    details.append(note);
    parent.append(details);
    return;
  }

  const options = [...progress.categories.map((category) => category.name), OTHER_CATEGORY];
  for (const classification of progress.classifications
    .filter((item) => item.confidence < report.lowConfidenceThreshold)
    .sort((left, right) => left.confidence - right.confidence)) {
    const bookmark = bookmarkMap.get(classification.bookmarkId);
    if (!bookmark) continue;
    const row = document.createElement('div');
    row.className = 'review-row';

    const title = document.createElement('div');
    title.className = 'review-title';
    title.textContent = bookmark.title || bookmark.url;

    const meta = document.createElement('div');
    meta.className = 'review-meta';
    const path = bookmark.parentPath ? ` · ${bookmark.parentPath}` : '';
    meta.textContent = `${bookmarkHost(bookmark.url)} · 置信 ${formatPercent(classification.confidence)} · 当前 ${categoryLabel(classification.category, progress)}${path}`;

    const select = document.createElement('select');
    select.className = 'review-category-select';
    select.dataset.bookmarkId = classification.bookmarkId;
    select.dataset.originalCategory = classification.category;
    select.setAttribute('aria-label', `调整分类: ${bookmark.title || bookmark.url}`);
    for (const categoryName of options) {
      const option = document.createElement('option');
      option.value = categoryName;
      option.textContent = categoryName === OTHER_CATEGORY ? OTHER_CATEGORY : categoryLabel(categoryName, progress);
      if (categoryName === classification.category) option.selected = true;
      select.append(option);
    }
    if (!options.includes(classification.category)) {
      const option = document.createElement('option');
      option.value = classification.category;
      option.textContent = `未知: ${classification.category}`;
      option.selected = true;
      select.prepend(option);
    }

    row.append(title, meta, select);
    details.append(row);
  }
  parent.append(details);
}

function previewQualityText(preview: PreviewRow): string {
  const parts = preview.parentName
    ? [`父级 ${preview.parentName}`, `置信 ${formatPercent(preview.averageConfidence)}`]
    : [`置信 ${formatPercent(preview.averageConfidence)}`];
  if (preview.lowConfidenceCount > 0) parts.push(`${preview.lowConfidenceCount} 低置信度`);
  if (preview.flags.length > 0) parts.push(preview.flags.join(' / '));
  return parts.join(' · ');
}

function appendPreviewRow(parent: HTMLElement, preview: PreviewRow): void {
  const row = document.createElement('div');
  const isRisky = preview.flags.some((flag) => flag.includes('低置信度') || flag.includes('过大'));
  row.className = [
    'preview-row',
    preview.editable ? 'editable' : '',
    preview.flags.length > 0 ? 'flagged' : '',
    isRisky ? 'risky' : '',
  ].filter(Boolean).join(' ');
  let nameEl: HTMLElement;
  if (preview.editable) {
    const input = document.createElement('input');
    input.className = 'preview-name-input';
    input.type = 'text';
    input.value = preview.name;
    input.dataset.originalCategory = preview.name;
    input.setAttribute('aria-label', `分类名: ${preview.name}`);
    nameEl = input;
  } else {
    const span = document.createElement('span');
    span.className = 'preview-name';
    span.textContent = preview.name;
    nameEl = span;
  }
  const countEl = document.createElement('span');
  countEl.className = 'preview-count';
  countEl.textContent = String(preview.count);
  const qualityEl = document.createElement('span');
  qualityEl.className = 'preview-quality';
  qualityEl.textContent = previewQualityText(preview);
  row.append(nameEl, countEl, qualityEl);
  parent.append(row);
}

function renderPreview(progress: Progress | null): void {
  previewEl.replaceChildren();
  if (progress?.status !== 'preview') {
    previewEl.hidden = true;
    latestQualityReportText = '';
    copyQualityReportButton.disabled = true;
    copyQualityReportButton.hidden = true;
    return;
  }

  const qualityReport = buildCategoryQualityReport(progress);
  latestQualityReportText = formatCategoryQualityReport(qualityReport);
  copyQualityReportButton.disabled = false;
  copyQualityReportButton.hidden = false;
  appendQualitySummary(previewEl, qualityReport);
  appendReviewPanel(previewEl, progress, qualityReport);

  const header = document.createElement('div');
  header.className = 'preview-header';
  const nameHeader = document.createElement('span');
  nameHeader.textContent = '分类名';
  const countHeader = document.createElement('span');
  countHeader.textContent = '书签数';
  header.append(nameHeader, countHeader);
  previewEl.append(header);

  for (const row of previewRows(progress, qualityReport)) appendPreviewRow(previewEl, row);
  previewEl.hidden = false;
}

function collectCategoryRenames(): CategoryRename[] {
  const inputs = Array.from(previewEl.querySelectorAll<HTMLInputElement>('.preview-name-input'));
  const seen = new Set<string>();
  const renames: CategoryRename[] = [];

  for (const input of inputs) {
    const from = input.dataset.originalCategory ?? '';
    const to = input.value.trim();
    if (!to) throw new Error('分类名不能为空');
    if (seen.has(to)) throw new Error(`分类名不能重复: ${to}`);
    seen.add(to);
    if (from && to !== from) renames.push({ from, to });
  }

  return renames;
}

function collectCategoryOverrides(): BookmarkCategoryOverride[] {
  const selects = Array.from(previewEl.querySelectorAll<HTMLSelectElement>('.review-category-select'));
  const overrides: BookmarkCategoryOverride[] = [];

  for (const select of selects) {
    const bookmarkId = select.dataset.bookmarkId ?? '';
    const from = select.dataset.originalCategory ?? '';
    const category = select.value.trim();
    if (!bookmarkId || !category) continue;
    if (category !== from) overrides.push({ bookmarkId, category });
  }

  return overrides;
}

function appendDuplicateGroup(parent: HTMLElement, group: DuplicateGroup): void {
  const groupEl = document.createElement('div');
  groupEl.className = 'duplicate-group';

  const urlEl = document.createElement('span');
  urlEl.className = 'duplicate-url';
  const host = bookmarkHost(group.displayUrl);
  urlEl.title = host;
  urlEl.textContent = `${group.bookmarks.length} 个副本 · ${host}`;
  groupEl.append(urlEl);

  for (const bookmark of group.bookmarks.slice(0, MAX_BOOKMARKS_PER_GROUP)) {
    const itemEl = document.createElement('span');
    itemEl.className = 'duplicate-item';
    const path = bookmark.parentPath ? ` · ${bookmark.parentPath}` : '';
    itemEl.textContent = `${bookmark.title}${path}`;
    groupEl.append(itemEl);
  }

  const hiddenCount = group.bookmarks.length - MAX_BOOKMARKS_PER_GROUP;
  if (hiddenCount > 0) {
    const hiddenEl = document.createElement('span');
    hiddenEl.className = 'duplicate-item duplicate-path';
    hiddenEl.textContent = `...还有 ${hiddenCount} 个`;
    groupEl.append(hiddenEl);
  }

  parent.append(groupEl);
}

function renderHealthReport(report: BookmarkHealthReport): void {
  healthReportEl.replaceChildren();
  healthReportEl.hidden = false;

  const summary = document.createElement('div');
  summary.className = 'health-summary';
  if (report.duplicateGroups.length === 0) {
    summary.textContent = `已扫描 ${report.total} 个书签,未发现重复 URL。`;
    healthReportEl.append(summary);
    return;
  }

  summary.textContent = `已扫描 ${report.total} 个书签,发现 ${report.duplicateGroups.length} 组重复 URL,涉及 ${report.duplicateBookmarkCount} 个书签。`;
  healthReportEl.append(summary);
  const privacy = document.createElement('div');
  privacy.className = 'health-summary';
  privacy.textContent = '下方默认只显示域名、标题和位置;复制完整报告会包含完整 URL。';
  healthReportEl.append(privacy);

  for (const group of report.duplicateGroups.slice(0, MAX_DUPLICATE_GROUPS)) {
    appendDuplicateGroup(healthReportEl, group);
  }

  const hiddenGroupCount = report.duplicateGroups.length - MAX_DUPLICATE_GROUPS;
  if (hiddenGroupCount > 0) {
    const hiddenEl = document.createElement('div');
    hiddenEl.className = 'health-summary';
    hiddenEl.textContent = `还有 ${hiddenGroupCount} 组未在 popup 中展开。`;
    healthReportEl.append(hiddenEl);
  }
}

function appendDeadLink(parent: HTMLElement, result: DeadLinkResult): void {
  const itemEl = document.createElement('div');
  itemEl.className = 'dead-link';

  const titleEl = document.createElement('span');
  titleEl.className = 'dead-link-title';
  titleEl.textContent = result.bookmark.title || bookmarkHost(result.bookmark.url);

  const statusEl = document.createElement('span');
  statusEl.className = `dead-link-status ${result.status}`;
  statusEl.textContent = result.status === 'broken' ? '可能失效' : '无法确认';

  const metaEl = document.createElement('span');
  metaEl.className = 'dead-link-meta';
  const path = result.bookmark.parentPath ? ` · ${result.bookmark.parentPath}` : '';
  metaEl.textContent = `${result.reason}${path}`;

  itemEl.append(titleEl, statusEl, metaEl);
  parent.append(itemEl);
}

function renderDeadLinkReport(report: DeadLinkReport): void {
  healthReportEl.replaceChildren();
  healthReportEl.hidden = false;

  const summary = document.createElement('div');
  summary.className = 'health-summary';
  if (report.deadLinks.length === 0) {
    summary.textContent = `已联网检查 ${report.checked}/${report.total} 个 http(s) 书签,未发现可能失效链接。`;
    healthReportEl.append(summary);
    return;
  }

  const brokenCount = report.deadLinks.filter((result) => result.status === 'broken').length;
  const unverifiedCount = report.deadLinks.length - brokenCount;
  summary.textContent = `已联网检查 ${report.checked}/${report.total} 个 http(s) 书签,发现 ${brokenCount} 个可能失效、${unverifiedCount} 个无法确认。`;
  healthReportEl.append(summary);
  const privacy = document.createElement('div');
  privacy.className = 'health-summary';
  privacy.textContent = '下方默认隐藏完整 URL;复制完整报告会包含 URL、跳转结果和原始位置。';
  healthReportEl.append(privacy);

  for (const result of report.deadLinks.slice(0, MAX_DEAD_LINKS)) appendDeadLink(healthReportEl, result);

  const hiddenCount = report.deadLinks.length - MAX_DEAD_LINKS;
  if (hiddenCount > 0) {
    const hiddenEl = document.createElement('div');
    hiddenEl.className = 'health-summary';
    hiddenEl.textContent = `还有 ${hiddenCount} 条未在 popup 中展开。`;
    healthReportEl.append(hiddenEl);
  }
}

function updateCopyHealthReportButton(): void {
  copyHealthReportButton.disabled = latestHealthReportText.length === 0;
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `已用时 ${seconds}s`;
  return `已用时 ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

function formatShortElapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `本批 ${seconds}s`;
  return `本批 ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

function progressMetaText(progress: Progress): string {
  const parts: string[] = [];
  const meta = progress.runMeta;
  if (!meta) return '';
  if (meta.totalBatches && meta.totalBatches > 0) {
    parts.push(`批次 ${meta.currentBatch ?? 0}/${meta.totalBatches}`);
  }
  const elapsed = formatElapsed(meta.startedAt);
  if (elapsed) parts.push(elapsed);
  const batchElapsed = progress.status === 'classifying' ? formatShortElapsed(meta.currentBatchStartedAt) : '';
  if (batchElapsed) parts.push(batchElapsed);
  parts.push(`重试 ${meta.retryCount ?? 0}`);
  if (meta.lastEvent) parts.push(meta.lastEvent);
  if (meta.lastBatchError) parts.push(`最近错误 ${meta.lastBatchError}`);
  return parts.join(' · ');
}

function progressCountText(progress: Progress): string {
  if (progress.status === 'categorizing') return progress.total > 0 ? `已扫描 ${progress.total} 个书签` : '正在准备分类体系';
  return progress.total > 0 ? `${progress.processed}/${progress.total}` : '准备中';
}

function updateProgressResume(progress: Progress | null, running: boolean, previewReady: boolean, stale: boolean): void {
  if (!progress || progress.status === 'idle' || demoPreviewActive) {
    progressResumeEl.hidden = true;
    progressResumeEl.textContent = '';
    progressResumeEl.className = 'progress-resume';
    return;
  }

  const metaText = progressMetaText(progress);
  progressResumeEl.hidden = false;
  progressResumeEl.className = 'progress-resume';
  if (stale) {
    progressResumeEl.classList.add('error');
    progressResumeEl.textContent = `后台可能已暂停 · 可点继续整理 · ${STATUS_TEXT[progress.status]} · ${progressCountText(progress)}${metaText ? ` · ${metaText}` : ''}`;
    return;
  }
  if (running) {
    progressResumeEl.textContent = `已恢复后台进度 · ${STATUS_TEXT[progress.status]} · ${progressCountText(progress)}${metaText ? ` · ${metaText}` : ''}`;
    return;
  }
  if (previewReady) {
    progressResumeEl.classList.add('ready');
    progressResumeEl.textContent = `上次预览已恢复 · ${progress.total} 个书签 / ${progress.categories.length} 个分类`;
    return;
  }
  if (progress.status === 'done') {
    progressResumeEl.classList.add('ready');
    progressResumeEl.textContent = `整理完成 · ${progress.total} 个书签 / ${progress.categories.length} 个分类`;
    return;
  }
  if (progress.status === 'stopped') {
    progressResumeEl.classList.add('error');
    progressResumeEl.textContent = `整理已停止 · ${progressCountText(progress)}`;
    return;
  }
  if (progress.status === 'error') {
    progressResumeEl.classList.add('error');
    progressResumeEl.textContent = `上次整理失败 · ${progress.error ?? '未知错误'}`;
    return;
  }
  progressResumeEl.hidden = true;
}

function renderProgress(progress: Progress | null): void {
  lastRenderedProgress = progress;
  statusEl.classList.remove('error', 'done');
  const hasSavedProgress = !!progress && progress.status !== 'idle';
  const stale = isStaleRunningProgress(progress);
  const running = isRunning(progress);
  const previewReady = progress?.status === 'preview';
  const demoPreview = previewReady && demoPreviewActive;
  const lowConfidenceCount = previewReady && progress ? buildCategoryQualityReport(progress).lowConfidenceCount : 0;
  updateProgressResume(progress, running, previewReady, stale);
  if (demoPreview) setModeBadge('demo');
  else if (running) setModeBadge('running');
  else if (stale) setModeBadge('paused');
  else if (previewReady) setModeBadge('preview');
  else if (progress?.status === 'done') setModeBadge('done');
  else if (progress?.status === 'stopped') setModeBadge('real');
  else setModeBadge('real');
  startButton.disabled = running;
  startButton.textContent = pendingPreflightKey
    ? '确认开始真实整理'
    : demoPreview
      ? '开始真实整理'
      : stale
        ? '继续整理'
      : previewReady
        ? '重新生成预览'
        : progress?.status === 'done' || progress?.status === 'stopped'
          ? '重新整理'
          : '开始整理';
  confirmWriteButton.disabled = demoPreview || !previewReady || running;
  confirmWriteButton.textContent = demoPreview
    ? '示例不写入'
    : lowConfidenceCount > 0
      ? `复查 ${lowConfidenceCount} 项后写入副本`
      : '确认写入副本';
  resetButton.disabled = !running && !hasSavedProgress && !demoPreview;
  resetButton.textContent = running ? '停止整理' : demoPreview ? '退出示例' : '清除进度';
  resetButton.classList.toggle('btn-danger', running);
  deleteOutputButton.disabled = demoPreview || !progress?.rootFolderId || running;
  barFill.style.width = `${percentOf(progress)}%`;
  renderPreview(progress);

  if (!progress) {
    statusEl.textContent = '待命';
    return;
  }

  if (progress.status === 'error') {
    statusEl.classList.add('error');
    statusEl.textContent = `${STATUS_TEXT.error}: ${progress.error ?? '未知错误'}`;
    return;
  }

  if (progress.status === 'preview') {
    const categoryCount = progress.categories.length;
    const hierarchyText = progress.runMeta?.useTwoLevel ? '二级目录' : '一级目录';
    statusEl.textContent = demoPreview
      ? `示例预览: ${progress.total} 个合成书签 / ${categoryCount} 个分类,不会写入浏览器`
      : `预览就绪: ${progress.total} 个书签 / ${categoryCount} 个分类 / ${hierarchyText},可调整后写入副本`;
    return;
  }

  if (progress.status === 'done') {
    statusEl.classList.add('done');
    const categoryCount = progress.categories.length;
    statusEl.textContent = `整理完成: ${progress.total} 个书签 / ${categoryCount} 个分类`;
    return;
  }

  if (progress.status === 'stopped') {
    statusEl.textContent = `整理已停止 · 可重新整理或清除进度`;
    return;
  }

  if (stale) {
    statusEl.classList.add('error');
    statusEl.textContent = `后台可能已被 Chrome 暂停 · 点击继续整理会从已完成批次恢复`;
    return;
  }

  if (progress.status === 'categorizing') {
    const metaText = progressMetaText(progress);
    const scanned = progress.total > 0 ? `已扫描 ${progress.total} 个书签` : '';
    statusEl.textContent = `${STATUS_TEXT[progress.status]}${scanned ? ` · ${scanned}` : ''}${metaText ? ` · ${metaText}` : ''}`.trim();
    return;
  }

  const count = progress.total > 0 ? `(${progress.processed}/${progress.total})` : '';
  const metaText = progressMetaText(progress);
  statusEl.textContent = `${STATUS_TEXT[progress.status]} ${count}${metaText ? ` · ${metaText}` : ''}`.trim();
}

async function refreshProgressFromStorage(): Promise<void> {
  if (demoPreviewActive || pendingPreflightKey) return;
  renderProgress(await loadProgress());
}

function startProgressPolling(): void {
  if (progressPollTimer) window.clearInterval(progressPollTimer);
  progressPollTimer = window.setInterval(() => {
    void refreshProgressFromStorage().catch((error: unknown) => {
      console.warn('[lishu] failed to refresh progress', error);
    });
  }, 1000);
}

function endpointOriginPattern(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Endpoint 必须是完整的 http(s) 地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Endpoint 必须使用 http 或 https');
  }
  return `${url.origin}/*`;
}

function requestOrigins(origins: string[], denialMessage = '需要授权访问大模型 endpoint 后才能开始整理'): Promise<void> {
  const uniqueOrigins = Array.from(new Set(origins));
  if (uniqueOrigins.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: uniqueOrigins }, (granted) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!granted) {
        reject(new Error(denialMessage));
        return;
      }
      resolve();
    });
  });
}

function hasOrigins(origins: string[]): Promise<boolean> {
  const uniqueOrigins = Array.from(new Set(origins));
  if (uniqueOrigins.length === 0) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: uniqueOrigins }, (granted) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(granted);
    });
  });
}

function hasEndpointPermission(config: AppConfig): Promise<boolean> {
  return hasOrigins([endpointOriginPattern(config.llm.endpoint)]);
}

function ensureHostPermissions(config: AppConfig): Promise<void> {
  if (config.enrichMode === 'meta-scrape') {
    return requestOrigins(['<all_urls>'], '需要授权访问网页后才能抓取首页信息');
  }
  return requestOrigins([endpointOriginPattern(config.llm.endpoint)]);
}

function ensureDeadLinkPermissions(): Promise<void> {
  return requestOrigins(['<all_urls>'], '需要授权访问网页后才能检查失效链接');
}

function sendStart(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START', skipHealthCheck: true } satisfies Message, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
}

function sendCheckLlm(config: AppConfig): Promise<LlmHealthCheckResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'CHECK_LLM', config } satisfies Message, (response: ActionResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.ok || !response.health) {
        reject(new Error(response?.error ?? '模型探活失败'));
        return;
      }
      resolve(response.health);
    });
  });
}

function modelHealthKey(config: AppConfig): string {
  return [config.llm.protocol, config.llm.endpoint, config.llm.model].join('|');
}

function healthSummary(health: LlmHealthCheckResult): string {
  return `模型可用 · ${health.model} · ${health.latencyMs}ms`;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runModelHealthCheck(config: AppConfig): Promise<LlmHealthCheckResult> {
  const key = modelHealthKey(config);
  if (modelHealthPromise && modelHealthPromiseKey === key) return modelHealthPromise;
  modelHealthPromiseKey = key;
  modelHealthInFlight = true;
  setModelHealthStatus('正在探活模型,不发送书签...', 'checking');
  modelHealthPromise = sendCheckLlm(config)
    .then((health) => {
      setModelHealthStatus(healthSummary(health), 'ok');
      return health;
    })
    .catch((error: unknown) => {
      const message = errorMessageOf(error);
      setModelHealthStatus(`模型不可用 · ${message}`, 'error');
      throw new Error(`模型不可用: ${message}`);
    })
    .finally(() => {
      modelHealthInFlight = false;
      modelHealthPromise = null;
      modelHealthPromiseKey = '';
    });
  return modelHealthPromise;
}

async function maybeAutoCheckModelOnOpen(config: AppConfig, progress: Progress | null): Promise<void> {
  if (initialModelHealthCheckAttempted || isRunning(progress)) return;
  initialModelHealthCheckAttempted = true;
  if (!hasCompleteLlmConfig(config)) {
    modelHealthEl.hidden = true;
    return;
  }
  let permitted = false;
  try {
    permitted = await hasEndpointPermission(config);
  } catch (error) {
    setModelHealthStatus(`模型未探活 · ${errorMessageOf(error)}`, 'pending');
    return;
  }
  if (!permitted) {
    setModelHealthStatus('模型未探活 · 尚未授权 endpoint,开始整理时会先授权并检查', 'pending');
    return;
  }
  await runModelHealthCheck(config).catch(() => {});
}

function sendConfirmWrite(
  categoryRenames: CategoryRename[],
  categoryOverrides: BookmarkCategoryOverride[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'CONFIRM_WRITE', categoryRenames, categoryOverrides } satisfies Message, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
}

function sendAction(type: 'STOP' | 'RESET_PROGRESS' | 'DELETE_LAST_OUTPUT'): Promise<Progress | null> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type } satisfies Message, (response: ActionResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? '操作失败'));
        return;
      }
      resolve(response.progress ?? null);
    });
  });
}

function sendAnalyzeBookmarks(): Promise<BookmarkHealthReport> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'ANALYZE_BOOKMARKS' } satisfies Message, (response: ActionResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.ok || !response.report) {
        reject(new Error(response?.error ?? '书签体检失败'));
        return;
      }
      resolve(response.report);
    });
  });
}

function sendCheckDeadLinks(): Promise<DeadLinkReport> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'CHECK_DEAD_LINKS' } satisfies Message, (response: ActionResponse | undefined) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!response?.ok || !response.deadLinkReport) {
        reject(new Error(response?.error ?? '失效链接检测失败'));
        return;
      }
      resolve(response.deadLinkReport);
    });
  });
}

function setHealthButtonsDisabled(disabled: boolean): void {
  analyzeBookmarksButton.disabled = disabled;
  checkDeadLinksButton.disabled = disabled;
  copyHealthReportButton.disabled = disabled || latestHealthReportText.length === 0;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('复制失败,请手动选择报告内容');
}

async function saveCurrentConfig(): Promise<AppConfig> {
  const config = readForm();
  await saveConfig(config);
  savedApiKeyValue = config.llm.apiKey;
  updateApiKeyHint();
  return config;
}

function handleConfigChanged(): void {
  clearPreflight();
  updateApiKeyHint();
  if (!modelHealthInFlight) {
    try {
      const config = readForm();
      if (hasCompleteLlmConfig(config)) {
        setModelHealthStatus('配置已修改,开始整理前会重新探活', 'pending');
      } else {
        modelHealthEl.hidden = true;
      }
    } catch {
      modelHealthEl.hidden = true;
    }
  }
  setConfigStatus('有未保存修改', 'idle');
  saveButton.classList.remove('saved');
  saveButton.textContent = '保存配置';
  saveButton.disabled = false;
  renderProgress(lastRenderedProgress);
}

saveButton.addEventListener('click', () => {
  if (saveFeedbackTimer) window.clearTimeout(saveFeedbackTimer);
  saveButton.disabled = true;
  saveButton.classList.remove('saved');
  saveButton.textContent = '保存中...';
  setConfigStatus('正在保存配置...', 'idle');
  void saveCurrentConfig()
    .then((config) => {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      saveButton.classList.add('saved');
      saveButton.textContent = '已保存';
      setConfigStatus(config.llm.apiKey ? `已保存 · API Key 已保存 · ${time}` : `已保存 · API Key 未填写 · ${time}`, 'saved');
      hideConfigStatusAfter(5000);
      showToast('配置已保存');
      resetSaveButtonSoon();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      saveButton.disabled = false;
      saveButton.classList.remove('saved');
      saveButton.textContent = '保存配置';
      setConfigStatus(`保存失败: ${message}`, 'error');
      showToast(`保存失败: ${message}`, 'error');
    });
});

protocolSelect.addEventListener('change', () => {
  updateProtocolHints();
  handleConfigChanged();
});
endpointInput.addEventListener('input', handleConfigChanged);
apiKeyInput.addEventListener('input', handleConfigChanged);
modelInput.addEventListener('input', handleConfigChanged);
enrichModeSelect.addEventListener('change', handleConfigChanged);
batchSizeInput.addEventListener('input', handleConfigChanged);
hierarchyModeSelect.addEventListener('change', handleConfigChanged);
hierarchyThresholdInput.addEventListener('input', handleConfigChanged);

demoPreviewButton.addEventListener('click', () => {
  clearPreflight();
  demoPreviewActive = true;
  statusEl.classList.remove('error', 'done');
  renderProgress(buildDemoProgress());
});

startButton.addEventListener('click', () => {
  void (async () => {
    const config = readForm();
    validateConfigForStart(config);
    const resumeStale = isStaleRunningProgress(lastRenderedProgress);
    let preflightInfo: PreflightInfo;
    try {
      preflightInfo = await buildPreflightInfo(config);
    } catch (error) {
      endpointInput.classList.add('invalid');
      throw error;
    }
    if (!resumeStale && pendingPreflightKey !== preflightInfo.key) {
      demoPreviewActive = false;
      clearPreflight();
      pendingPreflightKey = preflightInfo.key;
      renderPreflight(preflightInfo);
      renderProgress(await loadProgress());
      statusEl.classList.remove('error', 'done');
      statusEl.textContent = '确认后会把书签标题和 URL 发给所选 LLM endpoint';
      startButton.textContent = '确认开始真实整理';
      return;
    }
    clearPreflight();
    startButton.disabled = true;
    statusEl.classList.remove('error', 'done');
    statusEl.textContent = '正在检查模型可用性';
    await ensureHostPermissions(config);
    await runModelHealthCheck(config);
    await saveConfig(config);
    savedApiKeyValue = config.llm.apiKey;
    updateApiKeyHint();
    demoPreviewActive = false;
    renderProgress(
      resumeStale && lastRenderedProgress
        ? {
            ...lastRenderedProgress,
            status: 'scanning',
            runMeta: {
              ...(lastRenderedProgress.runMeta ?? {}),
              lastEvent: '正在恢复后台整理',
            },
          }
        : {
            status: 'scanning',
            total: 0,
            processed: 0,
            categories: [],
            classifications: [],
            runMeta: {
              startedAt: new Date().toISOString(),
              batchSize: config.batchSize,
              retryCount: 0,
              endpointOrigin: preflightInfo.endpointOrigin,
              model: config.llm.model,
              hierarchyMode: config.hierarchyMode,
              hierarchyThreshold: config.hierarchyThreshold,
              lastEvent: '已确认真实整理范围',
            },
          },
    );
    await sendStart();
  })().catch((error: unknown) => {
    statusEl.classList.add('error');
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    startButton.disabled = false;
  });
});

confirmWriteButton.addEventListener('click', () => {
  void (async () => {
    const categoryRenames = collectCategoryRenames();
    const categoryOverrides = collectCategoryOverrides();
    confirmWriteButton.disabled = true;
    statusEl.classList.remove('error');
    statusEl.textContent = '正在写入整理副本';
    await sendConfirmWrite(categoryRenames, categoryOverrides);
  })().catch((error: unknown) => {
    statusEl.classList.add('error');
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    confirmWriteButton.disabled = false;
  });
});

analyzeBookmarksButton.addEventListener('click', () => {
  setHealthButtonsDisabled(true);
  latestHealthReportText = '';
  latestHealthReportContainsFullUrls = false;
  healthReportEl.hidden = true;
  healthReportEl.replaceChildren();
  healthStatusEl.classList.remove('error', 'done');
  healthStatusEl.textContent = '正在检查重复书签';
  void sendAnalyzeBookmarks()
    .then((report) => {
      latestHealthReportText = formatDuplicateReport(report);
      latestHealthReportContainsFullUrls = report.duplicateGroups.length > 0;
      healthStatusEl.classList.add('done');
      healthStatusEl.textContent =
        report.duplicateGroups.length === 0
          ? '未发现重复 URL'
          : `发现 ${report.duplicateGroups.length} 组重复 URL`;
      renderHealthReport(report);
      updateCopyHealthReportButton();
    })
    .catch((error: unknown) => {
      healthStatusEl.classList.add('error');
      healthStatusEl.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      setHealthButtonsDisabled(false);
    });
});

checkDeadLinksButton.addEventListener('click', () => {
  setHealthButtonsDisabled(true);
  latestHealthReportText = '';
  latestHealthReportContainsFullUrls = false;
  healthReportEl.hidden = true;
  healthReportEl.replaceChildren();
  healthStatusEl.classList.remove('error', 'done');
  healthStatusEl.textContent = '正在申请网页访问权限';
  void ensureDeadLinkPermissions()
    .then(() => {
      healthStatusEl.textContent = '正在联网检查失效链接';
      return sendCheckDeadLinks();
    })
    .then((report) => {
      latestHealthReportText = formatDeadLinkReport(report);
      latestHealthReportContainsFullUrls = report.deadLinks.length > 0;
      healthStatusEl.classList.add('done');
      healthStatusEl.textContent =
        report.deadLinks.length === 0 ? '未发现可能失效链接' : `发现 ${report.deadLinks.length} 条需复查链接`;
      renderDeadLinkReport(report);
      updateCopyHealthReportButton();
    })
    .catch((error: unknown) => {
      healthStatusEl.classList.add('error');
      healthStatusEl.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      setHealthButtonsDisabled(false);
    });
});

copyHealthReportButton.addEventListener('click', () => {
  if (!latestHealthReportText) return;
  if (
    latestHealthReportContainsFullUrls &&
    !window.confirm('完整报告包含书签 URL 和原始位置。确认复制后,公开粘贴前需要先删私密内容。')
  ) {
    return;
  }
  void copyTextToClipboard(latestHealthReportText)
    .then(() => {
      healthStatusEl.classList.remove('error');
      healthStatusEl.classList.add('done');
      healthStatusEl.textContent = '报告已复制,公开粘贴前请先删私密书签';
    })
    .catch((error: unknown) => {
      healthStatusEl.classList.add('error');
      healthStatusEl.textContent = error instanceof Error ? error.message : String(error);
      updateCopyHealthReportButton();
    });
});

copyQualityReportButton.addEventListener('click', () => {
  if (!latestQualityReportText) return;
  void copyTextToClipboard(latestQualityReportText)
    .then(() => {
      statusEl.classList.remove('error');
      statusEl.classList.add('done');
      statusEl.textContent = '分类质量报告已复制,公开粘贴前请先删私密书签';
    })
    .catch((error: unknown) => {
      statusEl.classList.add('error');
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    });
});

resetButton.addEventListener('click', () => {
  clearPreflight();
  if (isRunning(lastRenderedProgress)) {
    resetButton.disabled = true;
    statusEl.classList.remove('error', 'done');
    statusEl.textContent = '正在停止整理';
    void sendAction('STOP')
      .then((progress) => {
        renderProgress(progress);
        showToast('整理已停止');
      })
      .catch((error: unknown) => {
        statusEl.classList.add('error');
        statusEl.textContent = error instanceof Error ? error.message : String(error);
        resetButton.disabled = false;
      });
    return;
  }
  if (demoPreviewActive) {
    demoPreviewActive = false;
    void loadProgress().then((progress) => renderProgress(progress));
    return;
  }
  void sendAction('RESET_PROGRESS')
    .then((progress) => renderProgress(progress))
    .catch((error: unknown) => {
      statusEl.classList.add('error');
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    });
});

deleteOutputButton.addEventListener('click', () => {
  clearPreflight();
  void sendAction('DELETE_LAST_OUTPUT')
    .then((progress) => renderProgress(progress))
    .catch((error: unknown) => {
      statusEl.classList.add('error');
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    });
});

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'PROGRESS') {
    clearPreflight();
    demoPreviewActive = false;
    renderProgress(message.progress);
  }
});

window.addEventListener('pagehide', () => {
  if (progressPollTimer) window.clearInterval(progressPollTimer);
  if (saveFeedbackTimer) window.clearTimeout(saveFeedbackTimer);
  if (configStatusTimer) window.clearTimeout(configStatusTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
});

void (async () => {
  const initialConfig = await loadConfig();
  fillForm(initialConfig);
  configStatusEl.hidden = true;
  await refreshProgressFromStorage();
  startProgressPolling();
  void maybeAutoCheckModelOnOpen(initialConfig, lastRenderedProgress);
})();
