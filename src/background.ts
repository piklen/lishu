// service worker 入口 —— 接 popup 消息,编排整条整理管线
import type { CategoryRename, Message, Progress } from './types';
import { clearProgress, loadConfig, saveProgress, loadProgress } from './core/storage';
import { runOrganize, writePreviewedOrganize } from './core/pipeline';
import { getAllBookmarks, removeGeneratedFolder } from './core/bookmarks';
import { buildBookmarkHealthReport, buildDeadLinkReport } from './core/health';

let running = false;
let lastProgress: Progress | null = null;

function broadcast(progress: Progress): void {
  const msg: Message = { type: 'PROGRESS', progress };
  // popup 未打开时 sendMessage 会 reject,忽略即可(进度已存 storage)
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function handleStart(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const config = await loadConfig();
    if (!config.llm.endpoint || !config.llm.apiKey || !config.llm.model) {
      throw new Error('请先填写大模型 endpoint / key / model 并保存');
    }
    const savedProgress = await loadProgress();
    const resumableProgress = savedProgress?.status === 'preview' ? null : savedProgress;
    await runOrganize(config, async (p) => {
      lastProgress = p;
      await saveProgress(p);
      broadcast(p);
    }, resumableProgress, { previewBeforeWrite: true });
  } catch (e) {
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
    running = false;
  }
}

async function handleConfirmWrite(categoryRenames: CategoryRename[] = []): Promise<void> {
  if (running) return;
  running = true;
  try {
    const savedProgress = await loadProgress();
    if (!savedProgress) throw new Error('没有可写入的分类预览');
    await writePreviewedOrganize(savedProgress, async (p) => {
      lastProgress = p;
      await saveProgress(p);
      broadcast(p);
    }, categoryRenames);
  } catch (e) {
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
    void handleStart();
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'CONFIRM_WRITE') {
    void handleConfirmWrite(message.categoryRenames ?? []);
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'GET_PROGRESS') {
    void loadProgress().then((p) => sendResponse(p));
    return true; // 异步 sendResponse,保持消息通道开启
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
