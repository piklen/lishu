# Lishu (理书)

[![CI](https://github.com/piklen/lishu/actions/workflows/ci.yml/badge.svg)](https://github.com/piklen/lishu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

AI-powered Chrome bookmark organizer. Lishu scans your bookmarks, asks your own LLM to classify them, and writes the result into a new folder. Your original bookmark tree is not moved, edited, or deleted.

> 中文：理书是一个 Chrome MV3 扩展，用你自己配置的大模型整理书签。它只创建整理结果副本，不动原书签。

[Website](https://piklen.github.io/lishu/) · [Latest release](https://github.com/piklen/lishu/releases/latest) · [Privacy policy](PRIVACY.md)

![Lishu demo: configure an LLM, classify bookmarks, and write a separate output folder](docs/assets/demo.gif)

## What It Does

Lishu is for people who have years of saved Chrome bookmarks but do not want a bookmark manager that takes over their data.

1. Reads your bookmark titles and URLs from Chrome.
2. Proposes a small set of practical categories with your configured LLM.
3. Classifies bookmarks into those categories.
4. Shows a category-count preview where you can adjust category names.
5. Creates a separate output folder only after you confirm.
6. Runs local duplicate reports and opt-in dead-link checks when you want a cleanup pass.

The original bookmark tree stays where it is, so you can compare the generated result, delete it, or run Lishu again with different settings.

## Why Lishu

- **Non-destructive by design**: output is copied into a new `📚 理书整理 YYYY-MM-DD` folder.
- **Bring your own LLM**: OpenAI-compatible Chat Completions and Anthropic Messages API are supported.
- **Local-first**: no account, no backend, no bundled model key.
- **Preview before writing**: review category counts and adjust category names before Lishu creates the output folder.
- **Bookmark health checks**: detect repeated URLs locally, and check possible dead links only when you explicitly request network access.
- **Minimal default permissions**: by default it only asks for your LLM endpoint origin. Broad page access is requested only when you enable homepage meta scraping.
- **Recoverable runs**: progress is saved in `chrome.storage.local`; the last generated output folder can be removed from the popup.

## Safety Model

| Concern | Lishu's behavior |
|---|---|
| Existing bookmarks | Never updates, moves, or deletes original bookmarks. |
| Output | Creates a new generated folder with bookmark copies. |
| API keys | Stored in `chrome.storage.local`, not Chrome sync. |
| Backend | No Lishu server. Requests go from your browser to your configured provider. |
| Host permissions | Default mode requests only your LLM endpoint origin. |
| Duplicate checks | Local read-only URL analysis, no webpage requests. |
| Dead-link checks | Opt-in network requests to bookmarked http(s) URLs, report only. |

## Install Locally

Requirements:

- Node.js 22+
- pnpm 10+
- Chrome or another Chromium-based browser with extension developer mode

Fast path:

1. Download `lishu-0.0.3.zip` from [Releases](https://github.com/piklen/lishu/releases).
2. Unzip it locally.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unzipped folder.

Build from source:

```bash
pnpm install
pnpm build
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Open Lishu from the toolbar, configure your LLM endpoint, API key, and model, then click **开始整理 / Start organizing**.
6. Review the category preview, adjust category names if needed, then click **确认写入副本 / Confirm write copy**.

Install troubleshooting:

- If Chrome says the manifest is missing, check that the selected folder contains `manifest.json`.
- For release installs, unzip `lishu-0.0.3.zip` first and select the unzipped folder, not the zip file.
- For source builds, select `dist/`, not the repository root.
- If Chrome does not show **Load unpacked**, enable **Developer mode** in `chrome://extensions`.
- After rebuilding from source, click the extension card's reload button in `chrome://extensions`.

## LLM Configuration

OpenAI-compatible example:

```text
Protocol: OpenAI compatible
Endpoint: https://api.openai.com/v1
Model: gpt-4o-mini
```

Anthropic example:

```text
Protocol: Anthropic Messages API
Endpoint: https://api.anthropic.com/v1/messages
Model: claude-...
```

OpenAI-compatible endpoints also work with providers such as DeepSeek, OpenRouter, LiteLLM, Ollama-compatible gateways, and private API gateways as long as they expose `/chat/completions`.

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for provider selection guidance, copy-paste examples, Ollama-compatible local gateways, and local-model JSON troubleshooting.

## Privacy And Permissions

Lishu stores configuration in `chrome.storage.local`.

- API keys are not synced through Chrome sync.
- There is no Lishu server.
- In the default mode, Lishu sends bookmark titles and URLs only to the LLM endpoint you configure.
- If you enable **homepage meta scraping**, Lishu requests broader page access and fetches only homepage metadata such as `<title>` and meta description.
- If you run **dead-link checking**, Lishu first requests broad page access, then contacts bookmarked http(s) URLs directly from your browser.
- Original bookmarks are not deleted, updated, or moved.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data flow.
See [PRIVACY.md](PRIVACY.md) for the public privacy policy.
See [docs/CATEGORY_QUALITY.md](docs/CATEGORY_QUALITY.md) for reviewing generated categories after a run.
See [docs/LAUNCH.md](docs/LAUNCH.md) for launch and feedback-posting drafts.
See [docs/SAMPLE_DATA.md](docs/SAMPLE_DATA.md) for synthetic bookmark data for public screenshots and manual QA.

## FAQ

**Can Lishu mess up my existing bookmarks?**

The organizing pipeline only creates folders and bookmark copies. It does not call `chrome.bookmarks.update` or `chrome.bookmarks.remove` on original bookmarks.

**Can I undo a generated result?**

Yes. The popup can delete the last generated `📚 理书整理 ...` output folder. It refuses to delete folders that were not generated by Lishu.

**Does Lishu send my bookmarks to a server?**

Lishu has no server. Bookmark titles and URLs are sent directly from your browser to the LLM endpoint you configure.

**Where is my API key stored?**

API keys are stored in `chrome.storage.local`, not Chrome sync. Lishu does not bundle provider keys or proxy requests through a Lishu backend.

**Can I use a local model?**

Yes, if the local runtime exposes an OpenAI-compatible `/chat/completions` API. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for Ollama-compatible and LM Studio examples, plus notes on local-model JSON quality.

**Can I review the result before anything is written?**

Yes. Lishu first shows a category-count preview where category names can be edited. It creates the generated output folder only after you confirm.

**Can Lishu delete duplicate bookmarks for me?**

No. The duplicate report is read-only. It points out repeated URLs so you can decide what to clean up manually.

**Does dead-link checking visit my bookmarked sites?**

Only when you click **检查失效链接 / Check dead links** and grant page access. Lishu sends direct browser requests to bookmarked http(s) URLs, limits concurrency and timeouts, and shows possible broken or unverified links without changing bookmarks.

**Why does meta scraping request broad page access?**

Chrome requires host permissions before an extension can fetch arbitrary website homepages. Lishu requests broad access only when you choose the homepage meta mode; the default mode only requests your LLM endpoint origin.

**What should I remove before sharing screenshots or logs?**

Do not share real API keys, private bookmark URLs, personal account names, or private bookmark titles. Use [docs/fixtures/sample-bookmarks.html](docs/fixtures/sample-bookmarks.html) for public screenshots unless real data has been reviewed and redacted.

## Development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm package:extension
bash scripts/check-secrets.sh
```

Project layout:

```text
src/background.ts      Extension service worker
src/popup/             Popup UI
src/core/              Bookmark scan, classification, pipeline, storage
src/providers/         LLM and enrichment providers
docs/                  PRD, architecture, roadmap
```

## Roadmap

- [Chrome Web Store listing prep](docs/STORE_LISTING.md)

## Contributing

Bug reports, focused pull requests, and provider integrations are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). New contributors can start with [good first issues](https://github.com/piklen/lishu/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).

## License

MIT. See [LICENSE](LICENSE).
