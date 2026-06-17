import { describe, expect, it } from 'vitest';
import { homepageOf, summarizeHomepageMeta } from './enrich';

describe('homepageOf', () => {
  it('把深层 URL 归一到首页', () => {
    expect(homepageOf('https://example.com/a/b?x=1')).toBe('https://example.com/');
  });

  it('跳过非网页协议和非法 URL', () => {
    expect(homepageOf('chrome://extensions')).toBeNull();
    expect(homepageOf('not-a-url')).toBeNull();
  });
});

describe('summarizeHomepageMeta', () => {
  it('提取 title 与 description 并压缩空白', () => {
    const html = `
      <html>
        <head>
          <title> Example  Site </title>
          <meta name="description" content="A &amp; B   tools">
        </head>
      </html>
    `;

    expect(summarizeHomepageMeta(html)).toBe('Example Site · A & B tools');
  });

  it('没有可用 meta 时返回 null', () => {
    expect(summarizeHomepageMeta('<html><body>hello</body></html>')).toBeNull();
  });
});
