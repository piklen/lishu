// popup 逻辑:配置、触发、进度展示
import type {
  AppConfig,
  BookmarkHealthReport,
  CategoryQualityReport,
  CategoryRename,
  DeadLinkReport,
  DeadLinkResult,
  DuplicateGroup,
  EnrichMode,
  LlmProtocol,
  Message,
  Progress,
  RunStatus,
} from '../types';
import { buildDemoProgress } from '../core/demo';
import { formatCategoryQualityReport, formatDeadLinkReport, formatDuplicateReport } from '../core/reportExport';
import { buildCategoryQualityReport } from '../core/quality';
import { loadConfig, loadProgress, normalizeConfig, saveConfig } from '../core/storage';

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '待命',
  scanning: '正在扫描书签',
  categorizing: '正在生成分类体系',
  classifying: '正在分批归类',
  preview: '等待确认写入',
  writing: '正在写入整理副本',
  done: '整理完成',
  error: '整理失败',
};

const OTHER_CATEGORY = '其他';
const MAX_DUPLICATE_GROUPS = 6;
const MAX_BOOKMARKS_PER_GROUP = 4;
const MAX_DEAD_LINKS = 8;

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
const statusEl = mustGet<HTMLDivElement>('status');
const barFill = mustGet<HTMLDivElement>('barFill');
const previewEl = mustGet<HTMLDivElement>('preview');
const healthStatusEl = mustGet<HTMLDivElement>('healthStatus');
const healthReportEl = mustGet<HTMLDivElement>('healthReport');

interface ActionResponse {
  ok: boolean;
  progress?: Progress;
  report?: BookmarkHealthReport;
  deadLinkReport?: DeadLinkReport;
  error?: string;
}

interface PreviewRow {
  name: string;
  count: number;
  editable: boolean;
  averageConfidence: number | null;
  lowConfidenceCount: number;
  flags: string[];
}

let latestHealthReportText = '';
let latestQualityReportText = '';
let demoPreviewActive = false;

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
  });
}

function fillForm(config: AppConfig): void {
  protocolSelect.value = config.llm.protocol;
  endpointInput.value = config.llm.endpoint;
  apiKeyInput.value = config.llm.apiKey;
  modelInput.value = config.llm.model;
  enrichModeSelect.value = config.enrichMode;
  batchSizeInput.value = String(config.batchSize);
  updateProtocolHints();
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

function isRunning(progress: Progress | null): boolean {
  return !!progress && ['scanning', 'categorizing', 'classifying', 'writing'].includes(progress.status);
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
    count: counts.get(category.name) ?? 0,
    editable: true,
    averageConfidence: qualityByName.get(category.name)?.averageConfidence ?? null,
    lowConfidenceCount: qualityByName.get(category.name)?.lowConfidenceCount ?? 0,
    flags: qualityByName.get(category.name)?.flags ?? [],
  }));
  if (otherCount > 0 && !categoryNames.has(OTHER_CATEGORY)) {
    rows.push({
      name: OTHER_CATEGORY,
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

function previewQualityText(preview: PreviewRow): string {
  const parts = [`置信 ${formatPercent(preview.averageConfidence)}`];
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

function appendDuplicateGroup(parent: HTMLElement, group: DuplicateGroup): void {
  const groupEl = document.createElement('div');
  groupEl.className = 'duplicate-group';

  const urlEl = document.createElement('span');
  urlEl.className = 'duplicate-url';
  urlEl.title = group.displayUrl;
  urlEl.textContent = `${group.bookmarks.length} 个副本 · ${group.displayUrl}`;
  groupEl.append(urlEl);

  for (const bookmark of group.bookmarks.slice(0, MAX_BOOKMARKS_PER_GROUP)) {
    const itemEl = document.createElement('span');
    itemEl.className = 'duplicate-item';
    itemEl.title = bookmark.url;
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
  titleEl.title = result.bookmark.url;
  titleEl.textContent = result.bookmark.title || result.bookmark.url;

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

function renderProgress(progress: Progress | null): void {
  statusEl.classList.remove('error', 'done');
  const hasSavedProgress = !!progress && progress.status !== 'idle';
  const running = isRunning(progress);
  const previewReady = progress?.status === 'preview';
  const demoPreview = previewReady && demoPreviewActive;
  startButton.disabled = running;
  startButton.textContent = demoPreview ? '开始真实整理' : previewReady ? '重新生成预览' : progress?.status === 'done' ? '重新整理' : '开始整理';
  confirmWriteButton.disabled = demoPreview || !previewReady || running;
  confirmWriteButton.textContent = demoPreview ? '示例不写入' : '确认写入副本';
  resetButton.disabled = (!hasSavedProgress && !demoPreview) || running;
  resetButton.textContent = demoPreview ? '退出示例' : '清除进度';
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
    statusEl.textContent = demoPreview
      ? `示例预览: ${progress.total} 个合成书签 / ${categoryCount} 个分类,不会写入浏览器`
      : `预览就绪: ${progress.total} 个书签 / ${categoryCount} 个分类,可调整分类名后写入副本`;
    return;
  }

  if (progress.status === 'done') {
    statusEl.classList.add('done');
    const categoryCount = progress.categories.length;
    statusEl.textContent = `整理完成: ${progress.total} 个书签 / ${categoryCount} 个分类`;
    return;
  }

  const count = progress.total > 0 ? `(${progress.processed}/${progress.total})` : '';
  statusEl.textContent = `${STATUS_TEXT[progress.status]} ${count}`.trim();
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
    chrome.runtime.sendMessage({ type: 'START' } satisfies Message, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
}

function sendConfirmWrite(categoryRenames: CategoryRename[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'CONFIRM_WRITE', categoryRenames } satisfies Message, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
}

function sendAction(type: 'RESET_PROGRESS' | 'DELETE_LAST_OUTPUT'): Promise<Progress | null> {
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
  return config;
}

saveButton.addEventListener('click', () => {
  void saveCurrentConfig()
    .then(() => {
      statusEl.classList.remove('error');
      statusEl.textContent = '配置已保存';
    })
    .catch((error: unknown) => {
      statusEl.classList.add('error');
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    });
});

protocolSelect.addEventListener('change', updateProtocolHints);

demoPreviewButton.addEventListener('click', () => {
  demoPreviewActive = true;
  statusEl.classList.remove('error', 'done');
  renderProgress(buildDemoProgress());
});

startButton.addEventListener('click', () => {
  void (async () => {
    const config = readForm();
    if (!config.llm.endpoint || !config.llm.apiKey || !config.llm.model) {
      throw new Error('请先填写 endpoint / API key / model');
    }
    await ensureHostPermissions(config);
    await saveConfig(config);
    demoPreviewActive = false;
    renderProgress({
      status: 'scanning',
      total: 0,
      processed: 0,
      categories: [],
      classifications: [],
    });
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
    confirmWriteButton.disabled = true;
    statusEl.classList.remove('error');
    statusEl.textContent = '正在写入整理副本';
    await sendConfirmWrite(categoryRenames);
  })().catch((error: unknown) => {
    statusEl.classList.add('error');
    statusEl.textContent = error instanceof Error ? error.message : String(error);
    confirmWriteButton.disabled = false;
  });
});

analyzeBookmarksButton.addEventListener('click', () => {
  setHealthButtonsDisabled(true);
  latestHealthReportText = '';
  healthReportEl.hidden = true;
  healthReportEl.replaceChildren();
  healthStatusEl.classList.remove('error', 'done');
  healthStatusEl.textContent = '正在检查重复书签';
  void sendAnalyzeBookmarks()
    .then((report) => {
      latestHealthReportText = formatDuplicateReport(report);
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
  void sendAction('DELETE_LAST_OUTPUT')
    .then((progress) => renderProgress(progress))
    .catch((error: unknown) => {
      statusEl.classList.add('error');
      statusEl.textContent = error instanceof Error ? error.message : String(error);
    });
});

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'PROGRESS') {
    demoPreviewActive = false;
    renderProgress(message.progress);
  }
});

void (async () => {
  fillForm(await loadConfig());
  renderProgress(await loadProgress());
})();
