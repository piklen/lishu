// provider 接口契约 —— 分类管线只依赖接口,不依赖具体实现
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';

export interface CategoryProposalOptions {
  hierarchyThreshold: number;
  signal?: AbortSignal;
}

export interface ClassificationOptions {
  signal?: AbortSignal;
}

export interface LlmHealthCheckOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** LLM provider(OpenAI 兼容) */
export interface LlmProvider {
  /** 最小请求探活:验证 endpoint/key/model 是否能返回,不发送书签 */
  checkModel(config: LlmConfig, options?: LlmHealthCheckOptions): Promise<void>;
  /** Pass A: 根据书签样本提议稳定类目;分类很多时允许用 parentName 收束成二级目录 */
  proposeCategories(sample: FlatBookmark[], config: LlmConfig, options: CategoryProposalOptions): Promise<Category[]>;
  /** Pass B: 把一批书签归入已定类目(返回含置信度) */
  classifyBatch(
    batch: FlatBookmark[],
    categories: Category[],
    config: LlmConfig,
    options?: ClassificationOptions,
  ): Promise<Classification[]>;
}

/** 网站用途探查 provider */
export interface EnrichProvider {
  /** 返回 url -> 描述;失败或无需增强的书签不返回 */
  describe(bookmarks: FlatBookmark[]): Promise<Map<string, string>>;
}
