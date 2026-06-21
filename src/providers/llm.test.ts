import { describe, expect, it, vi } from 'vitest';
import {
  llmProvider,
  normalizeAnthropicEndpoint,
  normalizeChatEndpoint,
  normalizeOpenAiEndpoint,
  parseJsonFromLlm,
} from './llm';

describe('normalizeChatEndpoint', () => {
  it('接受完整 chat completions 地址', () => {
    expect(normalizeChatEndpoint('https://api.example.com/v1/chat/completions/')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('把 /v1 base 地址补成 chat completions 地址', () => {
    expect(normalizeChatEndpoint('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });
});

describe('normalizeOpenAiEndpoint', () => {
  it('保留 OpenAI 兼容完整地址', () => {
    expect(normalizeOpenAiEndpoint('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('把无路径 base URL 补成 chat completions 地址', () => {
    expect(normalizeOpenAiEndpoint('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/chat/completions',
    );
  });
});

describe('normalizeAnthropicEndpoint', () => {
  it('把 Anthropic origin 补成 Messages API 地址', () => {
    expect(normalizeAnthropicEndpoint('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('把 /v1 base 地址补成 /v1/messages', () => {
    expect(normalizeAnthropicEndpoint('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });
});

describe('parseJsonFromLlm', () => {
  it('解析 markdown json 围栏', () => {
    expect(parseJsonFromLlm<{ ok: boolean }>('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('从解释文字中提取 JSON 数组', () => {
    expect(parseJsonFromLlm<number[]>('结果如下:\n[1,2,3]')).toEqual([1, 2, 3]);
  });
});

describe('llmProvider', () => {
  it('模型探活只发送最小 ping 请求', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content: 'OK' } }],
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await llmProvider.checkModel({
      protocol: 'openai-compatible',
      endpoint: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'health-model',
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1].body)) as {
      max_tokens?: number;
      messages: Array<{ content: string }>;
      model: string;
    };
    expect(body.model).toBe('health-model');
    expect(body.max_tokens).toBe(8);
    expect(JSON.stringify(body.messages)).toContain('ping');
    expect(JSON.stringify(body.messages)).not.toContain('https://');
    expect(JSON.stringify(body.messages)).not.toContain('书签');
  });

  it('模型探活使用短超时而不是等待完整分类超时', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }));
      vi.stubGlobal('fetch', fetchMock);

      const promise = llmProvider.checkModel({
        protocol: 'openai-compatible',
        endpoint: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'slow-model',
      });
      const assertion = expect(promise).rejects.toThrow('12 秒内没有响应');
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('按 Anthropic Messages API 协议发送请求并读取文本块', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        content: [{ type: 'text', text: '[{"name":"AI","description":"人工智能"}]' }],
      }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await llmProvider.proposeCategories(
      [{ id: '1', title: 'Anthropic API', url: 'https://anthropic.com/' }],
      {
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        apiKey: 'test-key',
        model: 'claude-test',
      },
      { hierarchyThreshold: 30 },
    );

    expect(result).toEqual([{ name: 'AI', description: '人工智能' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init)).toContain('超过 30 个精细分类');
  });

  it('LLM 长时间不响应时返回明确超时错误', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }));
      vi.stubGlobal('fetch', fetchMock);

      const promise = llmProvider.classifyBatch(
        [{ id: '1', title: 'Slow API', url: 'https://slow.example/' }],
        [{ name: '工具', description: '工具站点' }],
        {
          protocol: 'openai-compatible',
          endpoint: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'slow-model',
        },
      );
      const assertion = expect(promise).rejects.toThrow('LLM 请求超时');
      await vi.advanceTimersByTimeAsync(90_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('用户停止时中断正在等待的 LLM 请求', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = llmProvider.classifyBatch(
      [{ id: '1', title: 'Slow API', url: 'https://slow.example/' }],
      [{ name: '工具', description: '工具站点' }],
      {
        protocol: 'openai-compatible',
        endpoint: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'slow-model',
      },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toThrow('整理已停止');
  });
});
