// 网站用途探查 provider:默认不联网;可选抓网站首页 meta 增强
import type { EnrichMode, FlatBookmark } from '../types';
import type { EnrichProvider } from './types';

const META_FETCH_TIMEOUT_MS = 5000;
const META_CONCURRENCY = 4;
const MAX_DESCRIPTION_LENGTH = 220;

export function homepageOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}/`;
  } catch {
    return null;
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function attrOf(tag: string, attr: string): string | null {
  const quoted = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  if (quoted?.[1]) return normalizeText(quoted[1]);
  const bare = new RegExp(`${attr}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return bare?.[1] ? normalizeText(bare[1]) : null;
}

export function summarizeHomepageMeta(html: string): string | null {
  const head = html.slice(0, 120_000);
  const title = normalizeText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '');
  let description = '';

  for (const match of head.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    const key = attrOf(tag, 'name') ?? attrOf(tag, 'property');
    if (!key) continue;
    if (['description', 'og:description', 'twitter:description'].includes(key.toLowerCase())) {
      description = attrOf(tag, 'content') ?? '';
      if (description) break;
    }
  }

  const parts = [title, description].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(' · ').slice(0, MAX_DESCRIPTION_LENGTH);
}

async function fetchHomepageDescription(homepage: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(homepage, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.includes('text/html')) return null;
    return summarizeHomepageMeta(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

const worldKnowledgeProvider: EnrichProvider = {
  async describe() {
    return new Map();
  },
};

const metaScrapeProvider: EnrichProvider = {
  async describe(bookmarks) {
    const byHomepage = new Map<string, FlatBookmark[]>();
    for (const bookmark of bookmarks) {
      const homepage = homepageOf(bookmark.url);
      if (!homepage) continue;
      const group = byHomepage.get(homepage) ?? [];
      group.push(bookmark);
      byHomepage.set(homepage, group);
    }

    const descriptions = new Map<string, string>();
    await mapWithConcurrency(Array.from(byHomepage.keys()), META_CONCURRENCY, async (homepage) => {
      const description = await fetchHomepageDescription(homepage);
      if (!description) return;
      for (const bookmark of byHomepage.get(homepage) ?? []) {
        descriptions.set(bookmark.url, `站点首页: ${description}`);
      }
    });
    return descriptions;
  },
};

const searchApiProvider: EnrichProvider = {
  async describe() {
    throw new Error('search-api 探查暂未实现;v1 请使用 world-knowledge 或 meta-scrape');
  },
};

export function createEnrichProvider(mode: EnrichMode): EnrichProvider {
  if (mode === 'meta-scrape') return metaScrapeProvider;
  if (mode === 'search-api') return searchApiProvider;
  return worldKnowledgeProvider;
}
