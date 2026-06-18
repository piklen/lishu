# Lishu Launch Kit

> Copy-ready public launch material. Review platform rules and account context before posting.

## Core Links

- Website: https://piklen.github.io/lishu/
- GitHub: https://github.com/piklen/lishu
- Latest release: https://github.com/piklen/lishu/releases/latest
- Privacy policy: https://github.com/piklen/lishu/blob/main/PRIVACY.md
- Good first issue: https://github.com/piklen/lishu/issues/18

## Positioning

One-liner:

```text
Lishu is a local-first Chrome extension that organizes bookmarks with your own LLM into a new folder without moving originals.
```

Short pitch:

```text
I built Lishu for people whose Chrome bookmarks have grown into a pile they no longer trust.

It scans bookmarks, asks the LLM endpoint you configure to classify them, shows a category-count preview, and writes the result into a new generated folder only after confirmation.

The original bookmark tree is never moved, edited, or deleted.
```

Trust points:

- Local-first: no Lishu account, backend, telemetry, or bundled API key.
- Bring your own LLM: OpenAI-compatible and Anthropic endpoints.
- Non-destructive: generated copies go into a separate folder.
- Preview gate: classification finishes before any output folder is created.
- Health checks: duplicate URL reports are local-only; dead-link checks are opt-in and read-only.
- Open-source: MIT license, CI, privacy policy, provider examples, and a good first issue.

## Hacker News Draft

Title:

```text
Show HN: Lishu - organize Chrome bookmarks with your own LLM
```

Body:

```text
Hi HN,

I built Lishu, a local-first Chrome extension for organizing a large bookmark collection with your own LLM endpoint.

The main constraint is that it should not take over your bookmark tree:

- It reads bookmark titles and URLs.
- It asks the LLM endpoint you configure to propose and apply categories.
- It shows a category-count preview before writing.
- It writes a new generated folder with bookmark copies only after confirmation.
- It never moves, edits, or deletes original bookmarks.

It currently supports OpenAI-compatible Chat Completions and Anthropic Messages API. I have tested it on my own 700+ bookmark collection. There is no backend, account, telemetry, or bundled API key.

Website: https://piklen.github.io/lishu/
GitHub: https://github.com/piklen/lishu

Feedback I am especially interested in:
- safer UX for bookmark cleanup workflows
- better local/private LLM provider examples
- how to evaluate category quality without reading every bookmark manually
```

## Reddit Draft

Suggested subreddits, only if rules allow project sharing:

- r/selfhosted, if framed around local-first and bring-your-own provider
- r/chrome_extensions, if project sharing is allowed
- r/LocalLLaMA, if focused on local OpenAI-compatible endpoints
- r/opensource, if asking for contribution feedback rather than promotion

Title:

```text
I made a local-first Chrome bookmark organizer that uses your own LLM endpoint
```

Body:

```text
I built Lishu, an MIT-licensed Chrome MV3 extension for cleaning up large bookmark collections.

It does not run a backend or ship an API key. You configure your own OpenAI-compatible or Anthropic endpoint, then Lishu classifies bookmarks and writes the result into a new generated folder.

The safety model is the main point:

- original bookmarks are never moved, edited, or deleted
- category counts are shown before any write happens
- duplicate reports are local-only
- dead-link checks are opt-in and report-only
- API keys stay in chrome.storage.local

Website: https://piklen.github.io/lishu/
GitHub: https://github.com/piklen/lishu

I am looking for feedback on provider compatibility and the safest way to make bookmark cleanup useful without becoming destructive.
```

## X / Mastodon Draft

```text
I built Lishu, a local-first Chrome extension that organizes bookmarks with your own LLM endpoint.

It previews categories first, then writes a new generated folder only after confirmation. Original bookmarks are never moved, edited, or deleted.

https://piklen.github.io/lishu/
https://github.com/piklen/lishu
```

## Chinese Draft

```text
我做了一个开源 Chrome 扩展：理书 Lishu。

它用你自己配置的大模型 endpoint 整理浏览器书签：先扫描标题和 URL，让模型生成分类并归类，展示分类数量预览，确认后才把结果写到一个新的整理文件夹里。

核心原则是不接管你的书签：
- 原书签不移动、不编辑、不删除
- 没有后端、没有账号、没有内置 API key
- 重复 URL 检测是本地只读
- 失效链接检测需要显式授权，只生成报告

Website: https://piklen.github.io/lishu/
GitHub: https://github.com/piklen/lishu
```

## Product Hunt / Directory Draft

Tagline:

```text
Organize Chrome bookmarks with your own LLM.
```

Description:

```text
Lishu is a local-first Chrome bookmark organizer. It uses your own OpenAI-compatible or Anthropic endpoint to classify bookmarks, previews category counts, and writes a separate generated folder only after confirmation. Original bookmarks are never moved, edited, or deleted.
```

## Launch Checklist

- [ ] Confirm the latest release zip matches README install instructions.
- [ ] Confirm CI badge is green.
- [ ] Confirm https://piklen.github.io/lishu/ returns HTTP 200.
- [ ] Confirm screenshots do not expose real API keys, private bookmarks, or personal account data.
- [ ] Pick one primary feedback question before posting.
- [ ] Do not post the same text to many communities on the same day.
- [ ] Watch issues for the first 24 hours after posting.

## Useful Follow-Up Issues

If launch feedback arrives, prefer small public issues:

- Provider compatibility notes.
- Import/export or report output formats.
- Category editing before write.
- Safer cleanup workflow for duplicates.
- Better local-model JSON reliability.
