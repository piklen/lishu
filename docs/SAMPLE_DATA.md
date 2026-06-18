# Sample Bookmark Data

Use this synthetic fixture when preparing public screenshots, docs, launch posts, or manual QA notes:

- [`docs/fixtures/sample-bookmarks.html`](fixtures/sample-bookmarks.html)

The fixture contains 36 fake bookmarks across Engineering, AI Providers, Design And Product, Finance Learning, Reading And Reference, and Tools And Utilities. It intentionally includes one repeated URL so the local duplicate report has something safe to detect.

## Privacy Rules

- Do not use a real Chrome bookmark export for public screenshots.
- Do not show real API keys, real account names, private URLs, or personal browsing history.
- Keep public demos on synthetic data unless the screenshot has been reviewed and redacted.
- The fixture uses `.test` domains. They are not meant to be opened as real websites.
- Dead-link checking this fixture will likely report broken or unverified links. Use it for UI/report screenshots, not for measuring real website availability.

## Manual QA Flow

Use an isolated Chrome profile so the sample import does not mix with personal bookmarks.

1. Open Chrome's bookmark manager.
2. Choose **Import bookmarks**.
3. Select `docs/fixtures/sample-bookmarks.html`.
4. Build Lishu with `pnpm build`.
5. Load `dist/` through `chrome://extensions`.
6. Configure a test LLM endpoint.
7. Run Lishu and capture the category preview, completion state, duplicate report, or settings screenshots.

Before publishing a screenshot, check that the image contains only synthetic bookmark titles, synthetic URLs, and placeholder provider settings.
