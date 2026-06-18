// 编排整条整理流程:扫描 → 定类目 → 探查 → 分批归类 → 非破坏写入
import type { AppConfig, FlatBookmark, Progress } from '../types';
import { getAllBookmarks, writeOrganized } from './bookmarks';
import { defineCategories, classifyAll } from './classify';
import { createEnrichProvider } from '../providers/enrich';

export type ProgressFn = (p: Progress) => void | Promise<void>;

export interface RunOrganizeOptions {
  previewBeforeWrite?: boolean;
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
    progress.status !== 'preview'
  );
}

function createEmitter(progress: Progress, onProgress: ProgressFn): (patch: Partial<Progress>) => Promise<void> {
  return async (patch: Partial<Progress>): Promise<void> => {
    Object.assign(progress, patch);
    await onProgress(progress);
  };
}

async function writeClassifiedProgress(progress: Progress, onProgress: ProgressFn): Promise<Progress> {
  const emit = createEmitter(progress, onProgress);
  const bookmarks = await getAllBookmarks();
  const currentBookmarkIds = new Set(bookmarks.map((b) => b.id));
  const classifications = progress.classifications.filter((c) => currentBookmarkIds.has(c.bookmarkId));

  await emit({
    status: 'writing',
    total: bookmarks.length,
    processed: classifications.length,
    classifications,
    rootFolderId: undefined,
  });
  const rootFolderId = await writeOrganized(bookmarks, progress.categories, classifications, async (id) => {
    await emit({ rootFolderId: id });
  });
  await emit({ status: 'done', processed: bookmarks.length, rootFolderId });
  return progress;
}

export async function writePreviewedOrganize(
  savedProgress: Progress,
  onProgress: ProgressFn,
): Promise<Progress> {
  if (savedProgress.status !== 'preview') {
    throw new Error('没有可写入的分类预览');
  }
  if (savedProgress.categories.length === 0) {
    throw new Error('分类预览不完整,请重新整理');
  }
  return writeClassifiedProgress(
    {
      ...savedProgress,
      error: undefined,
      rootFolderId: undefined,
    },
    onProgress,
  );
}

export async function runOrganize(
  config: AppConfig,
  onProgress: ProgressFn,
  savedProgress?: Progress | null,
  options: RunOrganizeOptions = {},
): Promise<Progress> {
  const progress: Progress = isResumable(savedProgress)
    ? {
        ...savedProgress,
        status: 'scanning',
        error: undefined,
        rootFolderId: undefined,
      }
    : freshProgress();
  const emit = createEmitter(progress, onProgress);

  // 1. 扫描全部书签
  const bookmarks = await getAllBookmarks();
  await emit({ status: 'scanning', total: bookmarks.length });
  if (bookmarks.length === 0) {
    await emit({ status: 'done' });
    return progress;
  }

  // 2. Pass A 定类目
  const categories =
    progress.categories.length > 0
      ? progress.categories
      : await (async () => {
          await emit({ status: 'categorizing' });
          return defineCategories(bookmarks, config.llm);
        })();
  await emit({ categories });

  // 3. 探查(可选 meta-scrape)→ 描述仅融入喂给 LLM 的副本,不污染原 title
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

  await emit({ status: 'classifying' });
  const classifications = await classifyAll(
    remaining,
    categories,
    config.llm,
    config.batchSize,
    async (done) => {
      await emit({ processed: existingClassifications.length + done });
    },
  );
  await emit({
    processed: existingClassifications.length + remaining.length,
    classifications: [...existingClassifications, ...classifications],
  });

  if (options.previewBeforeWrite) {
    await emit({ status: 'preview' });
    return progress;
  }

  // 5. 非破坏式写入(用原始 bookmarks,title 干净)
  return writeClassifiedProgress(progress, onProgress);
}
