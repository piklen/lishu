# Security Policy

## Supported Versions

Lishu has not published a stable release yet. Security fixes are accepted on `main`.

## Reporting A Vulnerability

Please report vulnerabilities through GitHub Security Advisories if available, or open a minimal issue that avoids publishing secrets, tokens, or private bookmark data.

Include:

- Affected commit or version.
- Browser and operating system.
- Reproduction steps.
- Whether the issue can expose API keys, bookmark URLs, or generated output folders.

## Security Boundaries

Lishu is a local Chrome extension:

- It does not run a backend service.
- It does not ship a shared LLM API key.
- API keys are stored in `chrome.storage.local`.
- Bookmark titles and URLs are sent to the user-configured LLM endpoint.
- Homepage metadata is fetched only when the user selects meta scraping.
- Original bookmarks must not be moved, edited, or deleted by design.

## Permission Policy

Default runs request only the configured LLM endpoint origin. The extension requests broader page access only for homepage meta scraping.
