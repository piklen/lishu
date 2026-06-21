// LLM provider:支持 OpenAI 兼容 Chat Completions 与 Anthropic Messages API
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';
import type { LlmProvider } from './types';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
}

const ANTHROPIC_VERSION = '2023-06-01';
const LLM_REQUEST_TIMEOUT_MS = 90_000;
const LLM_HEALTH_TIMEOUT_MS = 12_000;

export function normalizeOpenAiEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') return `${url.origin}/chat/completions`;
  } catch {
    // 让 fetch 报出真实 URL 错误,这里不吞掉用户输入。
  }
  return trimmed;
}

export function normalizeAnthropicEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`;
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') return `${url.origin}/v1/messages`;
  } catch {
    // 让 fetch 报出真实 URL 错误,这里不吞掉用户输入。
  }
  return trimmed;
}

/** 兼容旧测试/旧调用命名 */
export const normalizeChatEndpoint = normalizeOpenAiEndpoint;

async function fetchWithLlmTimeout(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
  timeoutMs = LLM_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = (): void => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (externalSignal?.aborted && !timedOut) throw new Error('整理已停止');
      throw new Error(`LLM 请求超时: ${Math.round(timeoutMs / 1000)} 秒内没有响应,请检查 endpoint / model 或稍后重试`);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      if (externalSignal?.aborted && !timedOut) throw new Error('整理已停止');
      throw new Error(`LLM 请求超时: ${Math.round(timeoutMs / 1000)} 秒内没有响应,请检查 endpoint / model 或稍后重试`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function callOpenAiChat(messages: ChatMessage[], config: LlmConfig, options: ChatCallOptions = {}): Promise<string> {
  const body: Record<string, unknown> = { model: config.model, messages, temperature: 0.2 };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  const resp = await fetchWithLlmTimeout(normalizeOpenAiEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  }, options.signal, options.timeoutMs);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText} ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 响应缺少 content');
  return content;
}

async function checkOpenAiModel(config: LlmConfig, options: ChatCallOptions = {}): Promise<void> {
  const resp = await fetchWithLlmTimeout(normalizeOpenAiEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'You are a health check endpoint.' },
        { role: 'user', content: 'ping' },
      ],
      temperature: 0,
      max_tokens: options.maxTokens ?? 8,
    }),
  }, options.signal, options.timeoutMs);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText} ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json().catch(() => null)) as { choices?: unknown[] } | null;
  if (!Array.isArray(data?.choices)) throw new Error('模型探活响应格式异常');
}

function systemPromptOf(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

function userMessagesOf(messages: ChatMessage[]): { role: 'user'; content: string }[] {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => ({ role: 'user' as const, content: m.content }));
  return userMessages.length > 0 ? userMessages : [{ role: 'user', content: '请返回 JSON。' }];
}

async function callAnthropicMessages(messages: ChatMessage[], config: LlmConfig, options: ChatCallOptions = {}): Promise<string> {
  const resp = await fetchWithLlmTimeout(normalizeAnthropicEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemPromptOf(messages),
      messages: userMessagesOf(messages),
    }),
  }, options.signal, options.timeoutMs);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText} ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
  const content = data.content
    ?.filter((block) => !block.type || block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  if (!content) throw new Error('LLM 响应缺少 content');
  return content;
}

async function checkAnthropicModel(config: LlmConfig, options: ChatCallOptions = {}): Promise<void> {
  const resp = await fetchWithLlmTimeout(normalizeAnthropicEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options.maxTokens ?? 8,
      system: 'You are a health check endpoint.',
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }, options.signal, options.timeoutMs);
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText} ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json().catch(() => null)) as { content?: unknown[] } | null;
  if (!Array.isArray(data?.content)) throw new Error('模型探活响应格式异常');
}

/** 发一次模型请求,返回 assistant 文本 */
async function callChat(messages: ChatMessage[], config: LlmConfig, options: ChatCallOptions = {}): Promise<string> {
  if (config.protocol === 'anthropic') return callAnthropicMessages(messages, config, options);
  return callOpenAiChat(messages, config, options);
}

/** 从可能含 ```json``` 围栏或解释文字的文本里提取并解析 JSON */
export function parseJsonFromLlm<T>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const array = s.match(/\[[\s\S]*\]/);
    const object = s.match(/\{[\s\S]*\}/);
    const json = array?.[0] ?? object?.[0];
    if (!json) throw new Error('LLM 响应不是合法 JSON');
    return JSON.parse(json) as T;
  }
}

/** 单条书签压缩成一行喂给 LLM(title 可能已被 pipeline 用探查描述增强) */
function lineOf(b: FlatBookmark): string {
  return `[${b.id}] ${b.title} <${b.url}>`;
}

export const llmProvider: LlmProvider = {
  async checkModel(config, options = {}) {
    const callOptions: ChatCallOptions = {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? LLM_HEALTH_TIMEOUT_MS,
      maxTokens: 8,
    };
    if (config.protocol === 'anthropic') await checkAnthropicModel(config, callOptions);
    else await checkOpenAiModel(config, callOptions);
  },

  async proposeCategories(sample, config, options) {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是书签整理助手。根据用户的书签样本,提议一组稳定、互不重叠的中文分类。' +
          `默认提议 8~15 个一级分类;如果确实需要超过 ${options.hierarchyThreshold} 个精细分类,` +
          '必须给每个细分类增加 parentName,把它们收束到 6~12 个一级父类。' +
          'name 必须全局唯一,不要只在同一 parentName 下唯一。' +
          '只返回 JSON 数组,每项 {"name":"类目名","description":"一句话说明","parentName":"可选父级类目"}。不要 markdown,不要多余文字。',
      },
      { role: 'user', content: `书签样本:\n${sample.map(lineOf).join('\n')}` },
    ];
    return parseJsonFromLlm<Category[]>(await callChat(messages, config, { signal: options.signal }));
  },

  async classifyBatch(batch, categories, config, options = {}) {
    const cats = categories.map((c) => `- ${c.name}: ${c.description}`).join('\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是书签分类助手。把每个书签归入下面给定的类目之一(category 必须严格等于某个类目名,不得新造)。' +
          '依据网站用途判断,可用你已知的网站知识。' +
          '只返回 JSON 数组,每项 {"bookmarkId":"id","category":"类目名","confidence":0到1的小数}。不要 markdown。',
      },
      { role: 'user', content: `可用类目:\n${cats}\n\n待分类书签:\n${batch.map(lineOf).join('\n')}` },
    ];
    return parseJsonFromLlm<Classification[]>(await callChat(messages, config, { signal: options.signal }));
  },
};
