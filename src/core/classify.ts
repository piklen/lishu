// 两段式分类:Pass A 定类目 / Pass B 分批归类
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';
import { llmProvider } from '../providers/llm';

const SAMPLE_SIZE = 60;
const MAX_BATCH_ATTEMPTS = 2;

export interface ClassifyBatchProgress {
  phase: 'started' | 'retrying' | 'completed';
  done: number;
  currentBatch: number;
  totalBatches: number;
  attempt: number;
  retryCount: number;
  classifications?: Classification[];
  error?: string;
}

/** 均匀采样(代表性优于取前 N) */
export function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/** 切批 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += safeSize) out.push(arr.slice(i, i + safeSize));
  return out;
}

/** Pass A:采样书签 → 提议类目 */
export async function defineCategories(
  bookmarks: FlatBookmark[],
  config: LlmConfig,
  hierarchyThreshold: number,
  signal?: AbortSignal,
): Promise<Category[]> {
  return llmProvider.proposeCategories(sample(bookmarks, SAMPLE_SIZE), config, { hierarchyThreshold, signal });
}

/** Pass B:分批归类,每批完成回调进度 */
export async function classifyAll(
  bookmarks: FlatBookmark[],
  categories: Category[],
  config: LlmConfig,
  batchSize: number,
  onBatch: (progress: ClassifyBatchProgress) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<Classification[]> {
  const all: Classification[] = [];
  let done = 0;
  let retryCount = 0;
  const batches = chunk(bookmarks, batchSize);
  for (let index = 0; index < batches.length; index += 1) {
    if (signal?.aborted) throw new Error('整理已停止');
    const batch = batches[index] ?? [];
    const currentBatch = index + 1;
    for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
      await onBatch({ phase: 'started', done, currentBatch, totalBatches: batches.length, attempt, retryCount });
      try {
        const batchClassifications = await llmProvider.classifyBatch(batch, categories, config, { signal });
        all.push(...batchClassifications);
        done += batch.length;
        await onBatch({
          phase: 'completed',
          done,
          currentBatch,
          totalBatches: batches.length,
          attempt,
          retryCount,
          classifications: batchClassifications,
        });
        break;
      } catch (error) {
        if (signal?.aborted) throw new Error('整理已停止');
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= MAX_BATCH_ATTEMPTS) {
          throw new Error(`第 ${currentBatch}/${batches.length} 批分类失败: ${message}`);
        }
        retryCount += 1;
        await onBatch({
          phase: 'retrying',
          done,
          currentBatch,
          totalBatches: batches.length,
          attempt: attempt + 1,
          retryCount,
          error: message,
        });
      }
    }
  }
  return all;
}
