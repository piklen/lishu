// 两段式分类:Pass A 定类目 / Pass B 分批归类
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';
import { llmProvider } from '../providers/llm';

const SAMPLE_SIZE = 60;

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
): Promise<Category[]> {
  return llmProvider.proposeCategories(sample(bookmarks, SAMPLE_SIZE), config);
}

/** Pass B:分批归类,每批完成回调进度 */
export async function classifyAll(
  bookmarks: FlatBookmark[],
  categories: Category[],
  config: LlmConfig,
  batchSize: number,
  onBatch: (done: number) => void | Promise<void>,
): Promise<Classification[]> {
  const all: Classification[] = [];
  let done = 0;
  for (const batch of chunk(bookmarks, batchSize)) {
    all.push(...(await llmProvider.classifyBatch(batch, categories, config)));
    done += batch.length;
    await onBatch(done);
  }
  return all;
}
