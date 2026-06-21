// 编排整条整理流程:扫描 → 定类目 → 探查 → 分批归类 → 非破坏写入
import type { AppConfig, BookmarkCategoryOverride, CategoryRename, FlatBookmark, Progress } from '../types';
import { getAllBookmarks, shouldUseTwoLevel, writeOrganized } from './bookmarks';
import { defineCategories, classifyAll } from './classify';
import { createEnrichProvider } from '../providers/enrich';

export type ProgressFn = (p: Progress) => void | Promise<void>;

export interface RunOrganizeOptions {
  previewBeforeWrite?: boolean;
  signal?: AbortSignal;
}

function freshProgress(): Progress {
  return {
    status: 'scanning',
    total: 0,
    processed: 0,
    categories: [],
    classifications: [],
  };
}

function isResumable(progress: Progress | null | undefined): progress is Progress {
  return (
    !!progress &&
    progress.status !== 'done' &&
    progress.status !== 'idle' &&
    progress.status !== 'preview' &&
    progress.status !== 'stopped'
  );
}

function createEmitter(progress: Progress, onProgress: ProgressFn): (patch: Partial<Progress>) => Promise<void> {
  return async (patch: Partial<Progress>): Promise<void> => {
    const mergedRunMeta = patch.runMeta ? { ...(progress.runMeta ?? {}), ...patch.runMeta } : progress.runMeta;
    Object.assign(progress, patch);
    if (patch.runMeta) progress.runMeta = mergedRunMeta;
    await onProgress(progress);
  };
}

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint;
  }
}

function throwIfStopped(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('整理已停止');
}

function normalizedRenameMap(progress: Progress, renames: CategoryRename[]): Map<string, string> {
  const categoryNames = new Set(progress.categories.map((category) => category.name));
  const renameMap = new Map<string, string>();

  for (const rename of renames) {
    if (!categoryNames.has(rename.from)) continue;

    const to = rename.to.trim();
    if (!to) throw new Error('分类名不能为空');
    if (to === rename.from) continue;

    const previousTo = renameMap.get(rename.from);
    if (previousTo && previousTo !== to) {
      throw new Error(`分类改名冲突: ${rename.from}`);
    }
    renameMap.set(rename.from, to);
  }

  const seen = new Set<string>();
  for (const category of progress.categories) {
    const finalName = renameMap.get(category.name) ?? category.name;
    if (seen.has(finalName)) {
      throw new Error(`分类名不能重复: ${finalName}`);
    }
    seen.add(finalName);
  }

  return renameMap;
}

export function applyCategoryRenames(progress: Progress, renames: CategoryRename[] = []): Progress {
  if (renames.length === 0) return progress;
  const renameMap = normalizedRenameMap(progress, renames);
  if (renameMap.size === 0) return progress;

  return {
    ...progress,
    categories: progress.categories.map((category) => ({
      ...category,
      name: renameMap.get(category.name) ?? category.name,
    })),
    classifications: progress.classifications.map((classification) => ({
      ...classification,
      category: renameMap.get(classification.category) ?? classification.category,
    })),
  };
}

export function applyCategoryOverrides(
  progress: Progress,
  categoryOverrides: BookmarkCategoryOverride[] = [],
): Progress {
  if (categoryOverrides.length === 0) return progress;

  const allowedCategories = new Set([...progress.categories.map((category) => category.name), '其他']);
  const overrideMap = new Map<string, string>();
  for (const override of categoryOverrides) {
    const category = override.category.trim();
    if (!category) throw new Error('复查分类不能为空');
    if (!allowedCategories.has(category)) throw new Error(`复查分类不存在: ${category}`);
    overrideMap.set(override.bookmarkId, category);
  }
  if (overrideMap.size === 0) return progress;

  return {
    ...progress,
    classifications: progress.classifications.map((classification) => {
      const overrideCategory = overrideMap.get(classification.bookmarkId);
      return overrideCategory ? { ...classification, category: overrideCategory } : classification;
    }),
  };
}

async function writeClassifiedProgress(
  progress: Progress,
  onProgress: ProgressFn,
  config: AppConfig,
  signal?: AbortSignal,
): Promise<Progress> {
  const emit = createEmitter(progress, onProgress);
  throwIfStopped(signal);
  const bookmarks = await getAllBookmarks();
  const currentBookmarkIds = new Set(bookmarks.map((b) => b.id));
  const classifications = progress.classifications.filter((c) => currentBookmarkIds.has(c.bookmarkId));

  await emit({
    status: 'writing',
    total: bookmarks.length,
    processed: classifications.length,
    classifications,
    runMeta: { lastEvent: '正在创建整理副本' },
    rootFolderId: undefined,
  });
  const rootFolderId = await writeOrganized(
    bookmarks,
    progress.categories,
    classifications,
    async (id) => {
      await emit({ rootFolderId: id, runMeta: { lastEvent: '已创建整理根目录' } });
    },
    { hierarchyMode: config.hierarchyMode, hierarchyThreshold: config.hierarchyThreshold, signal },
  );
  throwIfStopped(signal);
  await emit({ status: 'done', processed: bookmarks.length, rootFolderId, runMeta: { lastEvent: '整理副本写入完成' } });
  return progress;
}

export async function writePreviewedOrganize(
  savedProgress: Progress,
  onProgress: ProgressFn,
  config: AppConfig,
  categoryRenames: CategoryRename[] = [],
  categoryOverrides: BookmarkCategoryOverride[] = [],
  signal?: AbortSignal,
): Promise<Progress> {
  if (savedProgress.status !== 'preview') {
    throw new Error('没有可写入的分类预览');
  }
  if (savedProgress.categories.length === 0) {
    throw new Error('分类预览不完整,请重新整理');
  }
  const renamed = applyCategoryRenames({
    ...savedProgress,
    error: undefined,
    rootFolderId: undefined,
  }, categoryRenames);
  return writeClassifiedProgress(applyCategoryOverrides(renamed, categoryOverrides), onProgress, config, signal);
}

export async function runOrganize(
  config: AppConfig,
  onProgress: ProgressFn,
  savedProgress?: Progress | null,
  options: RunOrganizeOptions = {},
): Promise<Progress> {
  const signal = options.signal;
  throwIfStopped(signal);
  const progress: Progress = isResumable(savedProgress)
    ? {
        ...savedProgress,
        status: 'scanning',
        error: undefined,
        rootFolderId: undefined,
        runMeta: {
          ...(savedProgress.runMeta ?? {}),
          startedAt: savedProgress.runMeta?.startedAt ?? new Date().toISOString(),
          batchSize: config.batchSize,
          retryCount: savedProgress.runMeta?.retryCount ?? 0,
          endpointOrigin: endpointOrigin(config.llm.endpoint),
          model: config.llm.model,
          hierarchyMode: config.hierarchyMode,
          hierarchyThreshold: config.hierarchyThreshold,
          lastEvent: '准备恢复整理',
        },
      }
    : {
        ...freshProgress(),
        runMeta: {
          startedAt: new Date().toISOString(),
          batchSize: config.batchSize,
          retryCount: 0,
          endpointOrigin: endpointOrigin(config.llm.endpoint),
          model: config.llm.model,
          hierarchyMode: config.hierarchyMode,
          hierarchyThreshold: config.hierarchyThreshold,
          lastEvent: '准备扫描书签',
        },
      };
  const emit = createEmitter(progress, onProgress);

  // 1. 扫描全部书签
  throwIfStopped(signal);
  const bookmarks = await getAllBookmarks();
  await emit({ status: 'scanning', total: bookmarks.length, bookmarks, runMeta: { lastEvent: '已扫描书签树' } });
  if (bookmarks.length === 0) {
    await emit({ status: 'done' });
    return progress;
  }

  // 2. Pass A 定类目
  throwIfStopped(signal);
  const categories =
    progress.categories.length > 0
      ? progress.categories
      : await (async () => {
          await emit({ status: 'categorizing', runMeta: { lastEvent: '正在等待 LLM 返回分类体系' } });
          return defineCategories(bookmarks, config.llm, config.hierarchyThreshold, signal);
        })();
  await emit({
    categories,
    runMeta: {
      lastEvent: '分类体系已生成',
      useTwoLevel: shouldUseTwoLevel(categories, {
        hierarchyMode: config.hierarchyMode,
        hierarchyThreshold: config.hierarchyThreshold,
      }),
    },
  });

  // 3. 探查(可选 meta-scrape)→ 描述仅融入喂给 LLM 的副本,不污染原 title
  throwIfStopped(signal);
  const descMap = await createEnrichProvider(config.enrichMode).describe(bookmarks);
  const enriched: FlatBookmark[] = bookmarks.map((b) => {
    const d = descMap.get(b.url);
    return d ? { ...b, title: `${b.title} — ${d}` } : b;
  });

  // 4. Pass B 分批归类
  const currentBookmarkIds = new Set(bookmarks.map((b) => b.id));
  const existingClassifications = progress.classifications.filter((c) =>
    currentBookmarkIds.has(c.bookmarkId),
  );
  const classifiedIds = new Set(existingClassifications.map((c) => c.bookmarkId));
  const remaining = enriched.filter((b) => !classifiedIds.has(b.id));
  const completedClassifications: Progress['classifications'] = [...existingClassifications];

  const totalBatches = Math.ceil(remaining.length / Math.max(1, Math.floor(config.batchSize)));
  throwIfStopped(signal);
  await emit({
    status: 'classifying',
    runMeta: {
      currentBatch: 0,
      totalBatches,
      lastEvent: totalBatches > 0 ? '准备分批归类' : '没有剩余书签需要归类',
    },
  });
  const classifications = await classifyAll(
    remaining,
    categories,
    config.llm,
    config.batchSize,
    async (batchProgress) => {
      const baseMeta = {
        currentBatch: batchProgress.currentBatch,
        totalBatches: batchProgress.totalBatches,
        retryCount: batchProgress.retryCount,
        currentBatchAttempt: batchProgress.attempt,
      };
      if (batchProgress.phase === 'started') {
        await emit({
          processed: existingClassifications.length + batchProgress.done,
          runMeta: {
            ...baseMeta,
            currentBatchStartedAt: new Date().toISOString(),
            lastBatchError: undefined,
            lastEvent:
              batchProgress.attempt > 1
                ? `正在重试第 ${batchProgress.currentBatch}/${batchProgress.totalBatches} 批`
                : `正在请求第 ${batchProgress.currentBatch}/${batchProgress.totalBatches} 批`,
          },
        });
        return;
      }
      if (batchProgress.phase === 'retrying') {
        await emit({
          processed: existingClassifications.length + batchProgress.done,
          runMeta: {
            ...baseMeta,
            lastBatchError: batchProgress.error,
            lastEvent: `第 ${batchProgress.currentBatch}/${batchProgress.totalBatches} 批失败,准备重试`,
          },
        });
        return;
      }
      if (batchProgress.classifications?.length) {
        completedClassifications.push(...batchProgress.classifications);
      }
      await emit({
        processed: existingClassifications.length + batchProgress.done,
        classifications: completedClassifications,
        runMeta: {
          ...baseMeta,
          lastBatchError: undefined,
          lastEvent: `已完成第 ${batchProgress.currentBatch}/${batchProgress.totalBatches} 批`,
        },
      });
    },
    signal,
  );
  throwIfStopped(signal);
  await emit({
    processed: existingClassifications.length + remaining.length,
    classifications: [...existingClassifications, ...classifications],
    runMeta: { lastEvent: '分批归类完成' },
  });

  if (options.previewBeforeWrite) {
    await emit({ status: 'preview', runMeta: { lastEvent: '预览已生成,等待确认写入' } });
    return progress;
  }

  // 5. 非破坏式写入(用原始 bookmarks,title 干净)
  return writeClassifiedProgress(progress, onProgress, config, signal);
}
