import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Progress } from '../types';
import { runOrganize, writePreviewedOrganize } from './pipeline';

const config: AppConfig = {
  llm: {
    protocol: 'openai-compatible',
    endpoint: 'https://llm.example/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
  enrichMode: 'world-knowledge',
  batchSize: 10,
};

function mockChatResponse(content: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    text: async () => '',
  };
}

describe('runOrganize', () => {
  beforeEach(() => {
    let createdId = 100;
    const create = vi.fn(async () => ({ id: String(createdId += 1) }));
    vi.stubGlobal('chrome', {
      bookmarks: {
        getTree: vi.fn(async () => [
          {
            id: '0',
            title: '',
            syncing: false,
            children: [
              {
                id: '1',
                title: '书签栏',
                syncing: false,
                children: [
                  { id: '2', title: 'GitHub', url: 'https://github.com/', syncing: false },
                  { id: '3', title: 'OpenAI', url: 'https://openai.com/', syncing: false },
                ],
              },
            ],
          },
        ]),
        create,
        remove: vi.fn(),
        update: vi.fn(),
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        const userContent = body.messages[1]?.content ?? '';
        if (userContent.includes('书签样本')) {
          return mockChatResponse([
            { name: '开发工具', description: '工程协作与代码托管' },
            { name: 'AI 工具', description: '人工智能产品与服务' },
          ]);
        }
        return mockChatResponse([
          { bookmarkId: '2', category: '开发工具', confidence: 0.95 },
          { bookmarkId: '3', category: 'AI 工具', confidence: 0.92 },
        ]);
      }),
    );
  });

  it('跑完整流程并只通过 create 写入整理副本', async () => {
    const progressEvents: Progress[] = [];
    const result = await runOrganize(config, (progress) => {
      progressEvents.push({ ...progress });
    });
    const bookmarks = chrome.bookmarks as typeof chrome.bookmarks & {
      remove: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };

    expect(result.status).toBe('done');
    expect(result.total).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.categories).toHaveLength(2);
    expect(result.classifications).toHaveLength(2);
    expect(progressEvents.at(-1)?.status).toBe('done');
    expect(bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('理书整理') }),
    );
    expect(bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'GitHub', url: 'https://github.com/' }),
    );
    expect(bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'OpenAI', url: 'https://openai.com/' }),
    );
    expect(bookmarks.remove).not.toHaveBeenCalled();
    expect(bookmarks.update).not.toHaveBeenCalled();
  });

  it('预览模式先停在分类预览,确认后才写入副本', async () => {
    const progressEvents: Progress[] = [];
    const preview = await runOrganize(
      config,
      (progress) => {
        progressEvents.push({ ...progress });
      },
      null,
      { previewBeforeWrite: true },
    );
    const bookmarks = chrome.bookmarks as typeof chrome.bookmarks & {
      create: ReturnType<typeof vi.fn>;
    };

    expect(preview.status).toBe('preview');
    expect(preview.total).toBe(2);
    expect(preview.processed).toBe(2);
    expect(preview.categories).toHaveLength(2);
    expect(preview.classifications).toHaveLength(2);
    expect(progressEvents.at(-1)?.status).toBe('preview');
    expect(bookmarks.create).not.toHaveBeenCalled();

    const writeEvents: Progress[] = [];
    const done = await writePreviewedOrganize(preview, (progress) => {
      writeEvents.push({ ...progress });
    });

    expect(writeEvents.map((progress) => progress.status)).toContain('writing');
    expect(done.status).toBe('done');
    expect(done.rootFolderId).toBeDefined();
    expect(bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('理书整理') }),
    );
  });
});
