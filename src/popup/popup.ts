// popup 逻辑:配置、触发、进度展示
import type { AppConfig, EnrichMode, LlmProtocol, Message, Progress, RunStatus } from '../types';
import { loadConfig, loadProgress, normalizeConfig, saveConfig } from '../core/storage';

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '待命',
  scanning: '正在扫描书签',
  categorizing: '正在生成分类体系',
  classifying: '正在分批归类',
  writing: '正在写入整理副本',
  done: '整理完成',
  error: '整理失败',
};

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
const statusEl = mustGet<HTMLDivElement>('status');
const barFill = mustGet<HTMLDivElement>('barFill');

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
  if (progress.total > 0) return Math.min(95, Math.round((progress.processed / progress.total) * 100));
  if (progress.status === 'categorizing') return 5;
  if (progress.status === 'scanning') return 2;
  return 0;
}

function renderProgress(progress: Progress | null): void {
  statusEl.classList.remove('error', 'done');
  startButton.disabled = isRunning(progress);
  barFill.style.width = `${percentOf(progress)}%`;

  if (!progress) {
    statusEl.textContent = '待命';
    return;
  }

  if (progress.status === 'error') {
    statusEl.classList.add('error');
    statusEl.textContent = `${STATUS_TEXT.error}: ${progress.error ?? '未知错误'}`;
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

function sendStart(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START' } satisfies Message, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
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
    const config = await saveCurrentConfig();
    if (!config.llm.endpoint || !config.llm.apiKey || !config.llm.model) {
      throw new Error('请先填写 endpoint / API key / model');
    }
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

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'PROGRESS') renderProgress(message.progress);
});

void (async () => {
  fillForm(await loadConfig());
  renderProgress(await loadProgress());
})();
