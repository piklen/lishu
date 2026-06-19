# Sample Bookmark Data

Use this synthetic fixture when preparing public screenshots, docs, launch posts, or manual QA notes:

- [`docs/fixtures/sample-bookmarks.html`](fixtures/sample-bookmarks.html)

The fixture contains 36 fake bookmarks across Engineering, AI Providers, Design And Product, Finance Learning, Reading And Reference, and Tools And Utilities. It intentionally includes one repeated URL so the local duplicate report has something safe to detect.

The popup also includes **体验示例预览 / Try demo preview**. That built-in demo uses synthetic in-app progress data, not this import fixture. Use the built-in demo when you only need to show the preview and quality score without importing bookmarks or configuring an API key; use the HTML fixture when you need Chrome bookmark-manager screenshots or end-to-end manual QA.

## Privacy Rules

- Do not use a real Chrome bookmark export for public screenshots.
- Do not show real API keys, real account names, private URLs, or personal browsing history.
- Keep public demos on synthetic data unless the screenshot has been reviewed and redacted.
- The fixture uses `.test` domains. They are not meant to be opened as real websites.
- Dead-link checking this fixture will likely report broken or unverified links. Use it for UI/report screenshots, not for measuring real website availability.

## Manual QA Flow

Use an isolated Chrome profile so the sample import does not mix with personal bookmarks.

Fast no-data check:

1. Build Lishu with `pnpm build`.
2. Load `dist/` through `chrome://extensions`.
3. Open the popup and click **体验示例预览 / Try demo preview**.
4. Confirm the preview shows a quality score, editable categories, disabled write action, and **复制质量报告 / Copy quality report**.

1. Open Chrome's bookmark manager.
2. Choose **Import bookmarks**.
3. Select `docs/fixtures/sample-bookmarks.html`.
4. Build Lishu with `pnpm build`.
5. Load `dist/` through `chrome://extensions`.
6. Configure a test LLM endpoint.
7. Run Lishu and capture the category preview, completion state, duplicate report, or settings screenshots.

Before publishing a screenshot, check that the image contains only synthetic bookmark titles, synthetic URLs, and placeholder provider settings.

## Editable Preview Screenshot Checklist

Use this checklist for public README, Store listing, launch, or issue screenshots of the category preview state.

- Use `docs/fixtures/sample-bookmarks.html`, not a real Chrome bookmark export.
- Capture the `preview` state before clicking **确认写入副本 / Confirm write copy**.
- Show several category rows with visible bookmark counts.
- Edit at least one category name so the screenshot demonstrates that generated category names are adjustable before writing.
- Keep the generated output folder unwritten unless the screenshot is specifically for completion-state QA.
- Confirm the screenshot does not show a real API key, private URL, personal account, real bookmark title, or private folder name.
- Keep the change documentation-only unless the PR explicitly updates screenshot assets.

## Completion-State Screenshot Checklist

Use this checklist when showing Lishu after the generated output folder has been written.

- Use `docs/fixtures/sample-bookmarks.html`, not a real Chrome bookmark export.
- Capture the `done` state after clicking **确认写入副本 / Confirm write copy**.
- Show the completed run summary or generated output confirmation state.
- If a generated folder is visible, confirm it contains only synthetic bookmark titles and synthetic `.test` URLs from the sample fixture.
- Confirm the screenshot does not show a real API key, private URL, personal account, real bookmark title, or private folder name.
- Keep the change documentation-only unless the PR explicitly updates screenshot assets.
