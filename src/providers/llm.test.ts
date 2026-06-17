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
  });
});
