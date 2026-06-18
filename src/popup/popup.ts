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
const resetButton = mustGet<HTMLButtonElement>('reset');
const deleteOutputButton = mustGet<HTMLButtonElement>('deleteOutput');
const statusEl = mustGet<HTMLDivElement>('status');
const barFill = mustGet<HTMLDivElement>('barFill');

interface ActionResponse {
  ok: boolean;
  progress?: Progress;
  error?: string;
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
  if (progress.total > 0) return Math.min(95, Math.round((progress.processed / progress.total) * 100));
  if (progress.status === 'categorizing') return 5;
  if (progress.status === 'scanning') return 2;
  return 0;
}

function renderProgress(progress: Progress | null): void {
  statusEl.classList.remove('error', 'done');
  const hasSavedProgress = !!progress && progress.status !== 'idle';
  const running = isRunning(progress);
  startButton.disabled = running;
  startButton.textContent = progress?.status === 'done' ? '重新整理' : '开始整理';
  resetButton.disabled = !hasSavedProgress || running;
  deleteOutputButton.disabled = !progress?.rootFolderId || running;
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

function requestOrigins(origins: string[]): Promise<void> {
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
        reject(new Error('需要授权访问大模型 endpoint 后才能开始整理'));
        return;
      }
      resolve();
    });
  });
}

function ensureHostPermissions(config: AppConfig): Promise<void> {
  if (config.enrichMode === 'meta-scrape') {
    return requestOrigins(['<all_urls>']);
  }
  return requestOrigins([endpointOriginPattern(config.llm.endpoint)]);
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
