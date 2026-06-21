// chrome.storage.local 读写:应用配置 + 整理进度
import type { AppConfig, Progress } from '../types';

const CONFIG_KEY = 'lishu:config';
const PROGRESS_KEY = 'lishu:progress';

export const DEFAULT_CONFIG: AppConfig = {
  llm: { protocol: 'openai-compatible', endpoint: '', apiKey: '', model: '' },
  enrichMode: 'world-knowledge',
  batchSize: 40,
  hierarchyMode: 'auto',
  hierarchyThreshold: 30,
};

export function normalizeConfig(config?: Partial<AppConfig>): AppConfig {
  return {
    llm: {
      ...DEFAULT_CONFIG.llm,
      ...(config?.llm ?? {}),
    },
    enrichMode: config?.enrichMode ?? DEFAULT_CONFIG.enrichMode,
    batchSize: Math.max(1, Math.min(100, Math.floor(config?.batchSize ?? DEFAULT_CONFIG.batchSize))),
    hierarchyMode: config?.hierarchyMode ?? DEFAULT_CONFIG.hierarchyMode,
    hierarchyThreshold: Math.max(
      5,
      Math.min(50, Math.floor(config?.hierarchyThreshold ?? DEFAULT_CONFIG.hierarchyThreshold)),
    ),
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const r = await chrome.storage.local.get(CONFIG_KEY);
  // 合并默认值,容忍旧版本缺字段
  return normalizeConfig(r[CONFIG_KEY] as Partial<AppConfig> | undefined);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: normalizeConfig(config) });
}

export async function loadProgress(): Promise<Progress | null> {
  const r = await chrome.storage.local.get(PROGRESS_KEY);
  return (r[PROGRESS_KEY] as Progress | undefined) ?? null;
}

export async function saveProgress(progress: Progress): Promise<void> {
  await chrome.storage.local.set({ [PROGRESS_KEY]: progress });
}

export async function clearProgress(): Promise<void> {
  await chrome.storage.local.remove(PROGRESS_KEY);
}
