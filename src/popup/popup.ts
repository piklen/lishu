// popup 逻辑:配置、触发、进度展示
import type {
  AppConfig,
  BookmarkHealthReport,
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
const startButton = mustGet<HTMLButtonElement>('start');
const confirmWriteButton = mustGet<HTMLButtonElement>('confirmWrite');
const analyzeBookmarksButton = mustGet<HTMLButtonElement>('analyzeBookmarks');
const checkDeadLinksButton = mustGet<HTMLButtonElement>('checkDeadLinks');
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

function previewRows(progress: Progress): PreviewRow[] {
  const categoryNames = new Set(progress.categories.map((category) => category.name));
  const counts = new Map(progress.categories.map((category) => [category.name, 0]));
  let otherCount = 0;

  for (const classification of progress.classifications) {
    if (categoryNames.has(classification.category)) {
      counts.set(classification.category, (counts.get(classification.category) ?? 0) + 1);
    } else {
      otherCount += 1;
    }
  }

  const unclassifiedCount = Math.max(0, progress.total - progress.classifications.length);
  otherCount += unclassifiedCount;
  if (otherCount > 0 && categoryNames.has(OTHER_CATEGORY)) {
    counts.set(OTHER_CATEGORY, (counts.get(OTHER_CATEGORY) ?? 0) + otherCount);
  }

  const rows = progress.categories.map((category) => ({
    name: category.name,
    count: counts.get(category.name) ?? 0,
    editable: true,
  }));
  if (otherCount > 0 && !categoryNames.has(OTHER_CATEGORY)) {
    rows.push({ name: OTHER_CATEGORY, count: otherCount, editable: false });
  }

  return rows
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function appendPreviewRow(parent: HTMLElement, preview: PreviewRow): void {
  const row = document.createElement('div');
  row.className = preview.editable ? 'preview-row editable' : 'preview-row';
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
  row.append(nameEl, countEl);
  parent.append(row);
}

function renderPreview(progress: Progress | null): void {
  previewEl.replaceChildren();
  if (progress?.status !== 'preview') {
    previewEl.hidden = true;
    return;
  }

  const header = document.createElement('div');
  header.className = 'preview-header';
  const nameHeader = document.createElement('span');
  nameHeader.textContent = '分类名';
  const countHeader = document.createElement('span');
  countHeader.textContent = '书签数';
  header.append(nameHeader, countHeader);
  previewEl.append(header);

  for (const row of previewRows(progress)) appendPreviewRow(previewEl, row);
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

function renderProgress(progress: Progress | null): void {
  statusEl.classList.remove('error', 'done');
  const hasSavedProgress = !!progress && progress.status !== 'idle';
  const running = isRunning(progress);
  const previewReady = progress?.status === 'preview';
  startButton.disabled = running;
  startButton.textContent = previewReady ? '重新生成预览' : progress?.status === 'done' ? '重新整理' : '开始整理';
  confirmWriteButton.disabled = !previewReady || running;
  resetButton.disabled = !hasSavedProgress || running;
  deleteOutputButton.disabled = !progress?.rootFolderId || running;
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
    statusEl.textContent = `预览就绪: ${progress.total} 个书签 / ${categoryCount} 个分类,可调整分类名后写入副本`;
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

startButton.addEventListener('click', () => {
  void (async () => {
    const config = readForm();
    if (!config.llm.endpoint || !config.llm.apiKey || !config.llm.model) {
      throw new Error('请先填写 endpoint / API key / model');
    }
    await ensureHostPermissions(config);
    await saveConfig(config);
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
  healthReportEl.hidden = true;
  healthReportEl.replaceChildren();
  healthStatusEl.classList.remove('error', 'done');
  healthStatusEl.textContent = '正在检查重复书签';
  void sendAnalyzeBookmarks()
    .then((report) => {
      healthStatusEl.classList.add('done');
      healthStatusEl.textContent =
        report.duplicateGroups.length === 0
          ? '未发现重复 URL'
          : `发现 ${report.duplicateGroups.length} 组重复 URL`;
      renderHealthReport(report);
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
      healthStatusEl.classList.add('done');
      healthStatusEl.textContent =
        report.deadLinks.length === 0 ? '未发现可能失效链接' : `发现 ${report.deadLinks.length} 条需复查链接`;
      renderDeadLinkReport(report);
    })
    .catch((error: unknown) => {
      healthStatusEl.classList.add('error');
      healthStatusEl.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      setHealthButtonsDisabled(false);
    });
});

resetButton.addEventListener('click', () => {
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
  if (message.type === 'PROGRESS') renderProgress(message.progress);
});

void (async () => {
  fillForm(await loadConfig());
  renderProgress(await loadProgress());
})();
