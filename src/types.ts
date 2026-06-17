// lishu 共享类型契约 —— 所有核心模块依赖此文件

/** 扁平化后的书签节点(只保留有 url 的叶子) */
export interface FlatBookmark {
  id: string;
  title: string;
  url: string;
  /** 原始所在文件夹路径(便于回溯,可选) */
  parentPath?: string;
}

/** LLM 协议 */
export type LlmProtocol = 'openai-compatible' | 'anthropic';

/** LLM 配置(用户在 popup 填) */
export interface LlmConfig {
  /** OpenAI 兼容 或 Anthropic Messages API */
  protocol: LlmProtocol;
  /** e.g. https://api.openai.com/v1 或 https://api.anthropic.com/v1/messages */
  endpoint: string;
  apiKey: string;
  /** e.g. gpt-4o-mini / deepseek-chat / claude-... */
  model: string;
}

/** 探查档位:world-knowledge=纯模型知识;meta-scrape=抓首页 meta;search-api=v2 预留 */
export type EnrichMode = 'world-knowledge' | 'meta-scrape' | 'search-api';

/** 应用配置(存 chrome.storage.local) */
export interface AppConfig {
  llm: LlmConfig;
  enrichMode: EnrichMode;
  /** 每批书签数(默认 40) */
  batchSize: number;
}

/** Pass A 产出的一个类目 */
export interface Category {
  name: string;
  description: string;
}

/** Pass B 单条归类结果 */
export interface Classification {
  bookmarkId: string;
  /** 归入的类目 name */
  category: string;
  /** 0~1 */
  confidence: number;
}

/** 整理状态机 */
export type RunStatus =
  | 'idle'
  | 'scanning'
  | 'categorizing'
  | 'classifying'
  | 'writing'
  | 'done'
  | 'error';

/** 整理进度(存 storage.local · service worker 续跑用) */
export interface Progress {
  status: RunStatus;
  total: number;
  processed: number;
  categories: Category[];
  classifications: Classification[];
  /** 写入后新建的文件夹 id(便于回滚/提示) */
  rootFolderId?: string;
  error?: string;
}

/** popup <-> background 消息协议 */
export type Message =
  | { type: 'START' }
  | { type: 'CANCEL' }
  | { type: 'GET_PROGRESS' }
  | { type: 'PROGRESS'; progress: Progress };
