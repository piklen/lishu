# Chrome Web Store Listing Draft

> Publishing prep for Lishu. Recheck Chrome Web Store policy pages before final submission; review requirements can change.

Official references checked on 2026-06-18:

- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [chrome.permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)

## Store Listing

Name:

```text
Lishu - AI Bookmark Organizer
```

Summary:

```text
Organize Chrome bookmarks with your own LLM into a new folder without moving originals.
```

Category:

```text
Productivity
```

Detailed description:

```text
Lishu is a local-first Chrome bookmark organizer.

It scans your bookmarks, asks the LLM endpoint you configure to classify them, shows a category-count preview where you can adjust category names, and writes the result into a new generated folder only after you confirm.

Your original bookmark tree is not moved, edited, or deleted.

Key features:
- Bring your own LLM endpoint: OpenAI-compatible Chat Completions and Anthropic Messages API.
- Local-first design: no Lishu account, no Lishu backend, no bundled API key.
- Non-destructive output: generated bookmark copies go into a separate folder.
- Preview before writing: classification finishes before any bookmark folder is created, and category names can be adjusted before confirmation.
- Bookmark health checks: duplicate URL reports are local-only; dead-link checks are opt-in and read-only.
- Minimal default permissions: broad page access is requested only for homepage meta scraping or dead-link checks.

Install from the release zip or build from source on GitHub.
```

## Privacy Tab Draft

Single purpose:

```text
Lishu organizes and checks Chrome bookmarks in a local-first, non-destructive workflow.
```

Permission justifications:

| Permission | Justification |
|---|---|
| `bookmarks` | Reads bookmark titles/URLs/folder paths and creates a generated output folder with bookmark copies. Original bookmarks are not moved, edited, or deleted. |
| `storage` | Stores local LLM configuration and run progress in `chrome.storage.local`. |
| Optional host access | Requests the configured LLM endpoint origin before organizing. Requests broader page access only when the user enables homepage meta scraping or starts dead-link checking. |

User data disclosure notes:

- Treat bookmark titles, URLs, and folder paths as sensitive browsing-related data.
- Disclose that bookmark titles/URLs are sent directly from the browser to the user-configured LLM endpoint during organization.
- Disclose that homepage meta scraping and dead-link checking contact bookmarked websites only after explicit user action.
- Link to [PRIVACY.md](../PRIVACY.md) from the Store listing and GitHub README.

Limited Use disclosure:

```text
Lishu uses bookmark data only to provide user-facing bookmark organization and bookmark health report features. Lishu does not sell user data, use user data for advertising, or transfer user data except to the LLM endpoint configured by the user and to bookmarked sites contacted by explicit opt-in features.
```

## Assets

Current repository assets:

| Asset | Use |
|---|---|
| `docs/assets/popup.png` | Store screenshot candidate showing configuration, non-destructive actions, and bookmark health checks. |
| `docs/assets/social-card.png` | Social preview image for launch posts and Open Graph sharing. |
| `docs/assets/demo.gif` | GitHub README demo. Convert selected frames to static PNG/JPEG if the Store requires static screenshots. |
| `docs/fixtures/sample-bookmarks.html` | Synthetic bookmark import fixture for public screenshots and manual QA. |

Additional screenshots to capture before submission:

- Category preview with several generated categories, counts, and editable category names.
- Completion state after writing generated folder.
- Dead-link report with synthetic/sample bookmarks, no private URLs.

Use [SAMPLE_DATA.md](SAMPLE_DATA.md), especially its editable preview and completion-state screenshot checklists, when capturing those screenshots.

## Pre-Submit Checklist

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm package:extension`
- [ ] `bash scripts/check-secrets.sh`
- [ ] Load the packaged extension in Chrome and verify the popup manually.
- [ ] Verify no real API key, private bookmark URL, or personal account appears in screenshots.
- [ ] Use synthetic sample bookmarks for public screenshots unless a screenshot has been reviewed and redacted.
- [ ] Confirm README, `PRIVACY.md`, and Store privacy answers describe the same data flow.
- [ ] Confirm Chrome Web Store review timing before planning a public announcement.
