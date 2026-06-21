// service worker 入口 —— 接 popup 消息,编排整条整理管线
import type {
  AppConfig,
  BookmarkCategoryOverride,
  CategoryRename,
  LlmHealthCheckResult,
  Message,
  Progress,
} from './types';
import { clearProgress, loadConfig, saveProgress, loadProgress } from './core/storage';
import { runOrganize, writePreviewedOrganize } from './core/pipeline';
import { getAllBookmarks, removeGeneratedFolder } from './core/bookmarks';
import { buildBookmarkHealthReport, buildDeadLinkReport } from './core/health';
import { llmProvider } from './providers/llm';

let running = false;
let lastProgress: Progress | null = null;
let currentRunAbort: AbortController | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function withHeartbeat(progress: Progress): Progress {
  progress.runMeta = {
    ...(progress.runMeta ?? {}),
    heartbeatAt: new Date().toISOString(),
  };
  return progress;
}

function broadcast(progress: Progress): void {
  const msg: Message = { type: 'PROGRESS', progress };
  // popup 未打开时 sendMessage 会 reject,忽略即可(进度已存 storage)
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function stoppedProgress(base: Progress | null): Progress {
  return {
    ...(base ?? {
      total: 0,
      processed: 0,
      categories: [],
      classifications: [],
    }),
    status: 'stopped',
    error: undefined,
    runMeta: {
      ...(base?.runMeta ?? {}),
      lastEvent: '用户已停止整理',
      heartbeatAt: new Date().toISOString(),
    },
  };
}

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint;
  }
}

async function checkLlmHealth(config: AppConfig): Promise<LlmHealthCheckResult> {
  const startedAt = Date.now();
  await llmProvider.checkModel(config.llm);
  return {
    endpointOrigin: endpointOrigin(config.llm.endpoint),
    model: config.llm.model,
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
}

async function handleCheckLlm(config?: AppConfig): Promise<LlmHealthCheckResult> {
  return checkLlmHealth(config ?? await loadConfig());
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!running || !lastProgress) return;
    const progress = withHeartbeat(lastProgress);
    void saveProgress(progress).then(() => broadcast(progress)).catch(() => {});
  }, 5_000);
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function handleStart(skipHealthCheck = false): Promise<void> {
  if (running) return;
  running = true;
  startHeartbeat();
  const runAbort = new AbortController();
  currentRunAbort = runAbort;
  try {
    const config = await loadConfig();
    if (!config.llm.endpoint || !config.llm.apiKey || !config.llm.model) {
      throw new Error('请先填写大模型 endpoint / key / model 并保存');
    }
    if (!skipHealthCheck) await checkLlmHealth(config);
    const savedProgress = await loadProgress();
    const resumableProgress = savedProgress?.status === 'preview' ? null : savedProgress;
    await runOrganize(config, async (p) => {
      const progress = withHeartbeat(p);
      lastProgress = progress;
      await saveProgress(progress);
      broadcast(progress);
    }, resumableProgress, { previewBeforeWrite: true, signal: runAbort.signal });
  } catch (e) {
    if (runAbort.signal.aborted) {
      const stopped = stoppedProgress(lastProgress);
      lastProgress = stopped;
      await saveProgress(stopped);
      broadcast(stopped);
      return;
    }
    const error = e instanceof Error ? e.message : String(e);
    const base: Progress = lastProgress ?? {
      status: 'error',
      total: 0,
      processed: 0,
      categories: [],
      classifications: [],
    };
    const errProgress: Progress = { ...base, status: 'error', error };
    lastProgress = errProgress;
    await saveProgress(errProgress);
    broadcast(errProgress);
  } finally {
    stopHeartbeat();
    if (currentRunAbort === runAbort) currentRunAbort = null;
    running = false;
  }
}

async function handleStop(): Promise<Progress> {
  currentRunAbort?.abort();
  stopHeartbeat();
  const base = lastProgress ?? await loadProgress();
  const progress = stoppedProgress(base);
  lastProgress = progress;
  await saveProgress(progress);
  broadcast(progress);
  return progress;
}

async function handleConfirmWrite(
  categoryRenames: CategoryRename[] = [],
  categoryOverrides: BookmarkCategoryOverride[] = [],
): Promise<void> {
  if (running) return;
  running = true;
  startHeartbeat();
  const runAbort = new AbortController();
  currentRunAbort = runAbort;
  try {
    const savedProgress = await loadProgress();
    if (!savedProgress) throw new Error('没有可写入的分类预览');
    const config = await loadConfig();
    await writePreviewedOrganize(savedProgress, async (p) => {
      const progress = withHeartbeat(p);
      lastProgress = progress;
      await saveProgress(progress);
      broadcast(progress);
    }, config, categoryRenames, categoryOverrides, runAbort.signal);
  } catch (e) {
    if (runAbort.signal.aborted) {
      const stopped = stoppedProgress(lastProgress);
      lastProgress = stopped;
      await saveProgress(stopped);
      broadcast(stopped);
      return;
    }
    const error = e instanceof Error ? e.message : String(e);
    const base: Progress = lastProgress ?? {
      status: 'error',
      total: 0,
      processed: 0,
      categories: [],
      classifications: [],
    };
    const errProgress: Progress = { ...base, status: 'error', error };
    lastProgress = errProgress;
    await saveProgress(errProgress);
    broadcast(errProgress);
  } finally {
    stopHeartbeat();
    if (currentRunAbort === runAbort) currentRunAbort = null;
    running = false;
  }
}

function idleProgress(): Progress {
  return {
    status: 'idle',
    total: 0,
    processed: 0,
    categories: [],
    classifications: [],
  };
}

async function handleResetProgress(): Promise<Progress> {
  await clearProgress();
  const progress = idleProgress();
  lastProgress = progress;
  broadcast(progress);
  return progress;
}

async function handleDeleteLastOutput(): Promise<Progress> {
  const progress = await loadProgress();
  if (!progress?.rootFolderId) {
    throw new Error('没有可删除的理书整理结果');
  }
  await removeGeneratedFolder(progress.rootFolderId);
  return handleResetProgress();
}

async function handleAnalyzeBookmarks() {
  return buildBookmarkHealthReport(await getAllBookmarks());
}

async function handleCheckDeadLinks() {
  return buildDeadLinkReport(await getAllBookmarks());
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'START') {
    void handleStart(message.skipHealthCheck ?? false);
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'CONFIRM_WRITE') {
    void handleConfirmWrite(message.categoryRenames ?? [], message.categoryOverrides ?? []);
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'GET_PROGRESS') {
    void loadProgress().then((p) => sendResponse(p));
    return true; // 异步 sendResponse,保持消息通道开启
  }
  if (message.type === 'CHECK_LLM') {
    void handleCheckLlm(message.config)
      .then((health) => sendResponse({ ok: true, health }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message.type === 'STOP') {
    void handleStop()
      .then((progress) => sendResponse({ ok: true, progress }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message.type === 'RESET_PROGRESS') {
    void handleResetProgress()
      .then((progress) => sendResponse({ ok: true, progress }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message.type === 'DELETE_LAST_OUTPUT') {
    void handleDeleteLastOutput()
      .then((progress) => sendResponse({ ok: true, progress }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message.type === 'ANALYZE_BOOKMARKS') {
    void handleAnalyzeBookmarks()
      .then((report) => sendResponse({ ok: true, report }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message.type === 'CHECK_DEAD_LINKS') {
    void handleCheckDeadLinks()
      .then((deadLinkReport) => sendResponse({ ok: true, deadLinkReport }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  return undefined;
});

console.log('[lishu] service worker loaded');
