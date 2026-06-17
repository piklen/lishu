// service worker 入口 —— 接 popup 消息,编排整条整理管线
import type { Message, Progress } from './types';
import { loadConfig, saveProgress, loadProgress } from './core/storage';
import { runOrganize } from './core/pipeline';

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
    await runOrganize(config, async (p) => {
      lastProgress = p;
      await saveProgress(p);
      broadcast(p);
    }, savedProgress);
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

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'START') {
    void handleStart();
    sendResponse({ ok: true });
    return undefined;
  }
  if (message.type === 'GET_PROGRESS') {
    void loadProgress().then((p) => sendResponse(p));
    return true; // 异步 sendResponse,保持消息通道开启
  }
  return undefined;
});

console.log('[lishu] service worker loaded');
