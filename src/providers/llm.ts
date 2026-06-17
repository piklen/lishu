// LLM provider:支持 OpenAI 兼容 Chat Completions 与 Anthropic Messages API
import type { FlatBookmark, Category, Classification, LlmConfig } from '../types';
import type { LlmProvider } from './types';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const ANTHROPIC_VERSION = '2023-06-01';

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

async function callOpenAiChat(messages: ChatMessage[], config: LlmConfig): Promise<string> {
  const resp = await fetch(normalizeOpenAiEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText} ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 响应缺少 content');
  return content;
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

async function callAnthropicMessages(messages: ChatMessage[], config: LlmConfig): Promise<string> {
  const resp = await fetch(normalizeAnthropicEndpoint(config.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemPromptOf(messages),
      messages: userMessagesOf(messages),
    }),
  });
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

/** 发一次模型请求,返回 assistant 文本 */
async function callChat(messages: ChatMessage[], config: LlmConfig): Promise<string> {
  if (config.protocol === 'anthropic') return callAnthropicMessages(messages, config);
  return callOpenAiChat(messages, config);
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
  async proposeCategories(sample, config) {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是书签整理助手。根据用户的书签样本,提议一组 8~15 个稳定、互不重叠的中文分类。' +
          '只返回 JSON 数组,每项 {"name":"类目名","description":"一句话说明"}。不要 markdown,不要多余文字。',
      },
      { role: 'user', content: `书签样本:\n${sample.map(lineOf).join('\n')}` },
    ];
    return parseJsonFromLlm<Category[]>(await callChat(messages, config));
  },

  async classifyBatch(batch, categories, config) {
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
    return parseJsonFromLlm<Classification[]>(await callChat(messages, config));
  },
};
