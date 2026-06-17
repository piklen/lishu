// provider 接口契约 —— 分类管线只依赖接口,不依赖具体实现
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';

/** LLM provider(OpenAI 兼容) */
export interface LlmProvider {
  /** Pass A: 根据书签样本提议 8~15 个稳定类目 */
  proposeCategories(sample: FlatBookmark[], config: LlmConfig): Promise<Category[]>;
  /** Pass B: 把一批书签归入已定类目(返回含置信度) */
  classifyBatch(
    batch: FlatBookmark[],
    categories: Category[],
    config: LlmConfig,
  ): Promise<Classification[]>;
}

/** 网站用途探查 provider */
export interface EnrichProvider {
  /** 返回 url -> 描述;失败或无需增强的书签不返回 */
  describe(bookmarks: FlatBookmark[]): Promise<Map<string, string>>;
}
