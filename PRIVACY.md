# Privacy Policy

Last updated: 2026-06-18

Lishu is a local-first Chrome extension for organizing and checking bookmarks. It does not run a Lishu backend, create a Lishu account, collect telemetry, sell data, or use data for advertising.

## Data Lishu Handles

Lishu may handle these data types inside your browser:

- Bookmark titles, URLs, and folder paths, read through Chrome's bookmarks API.
- LLM configuration that you enter, including endpoint, model name, and API key.
- Generated classification progress and the id of the last generated output folder.
- Optional homepage metadata when you enable homepage meta scraping.
- Optional dead-link check results, such as HTTP status or network error text.

API keys are stored in `chrome.storage.local`, not Chrome sync.

## How Data Is Used

Lishu uses bookmark data only for user-facing features:

- Classifying bookmarks into categories with the LLM endpoint you configure.
- Creating a new generated bookmark folder with bookmark copies after you confirm.
- Showing local duplicate URL reports.
- Showing opt-in dead-link reports.
- Saving progress so a run can recover if the extension worker restarts.

Lishu does not move, edit, or delete original bookmarks during organization. The duplicate and dead-link reports are read-only.

## Data Sharing

Lishu has no server. Network requests go directly from your browser:

- Bookmark titles and URLs are sent to the LLM endpoint you configure when you start organizing.
- Optional homepage meta scraping fetches homepage metadata from bookmarked sites.
- Optional dead-link checking sends direct browser requests to bookmarked http(s) URLs.

Your LLM provider or private gateway may process data according to its own terms and privacy policy. Lishu does not control provider-side retention or logging.

## Permissions

Lishu requests these base permissions:

- `bookmarks`: read bookmark trees and create generated output folders.
- `storage`: save local configuration and progress.

Lishu uses optional host permissions:

- Your configured LLM endpoint origin is requested before organizing.
- Broad page access is requested only when you choose homepage meta scraping or dead-link checking.

## User Control

You control when Lishu reads bookmarks, contacts providers, checks links, and writes generated output. You can clear progress in the popup and delete the last generated Lishu output folder from the popup. Uninstalling the extension removes its local extension storage through Chrome.

## Contact

Report privacy or security issues through GitHub Security Advisories when available, or open an issue at:

https://github.com/piklen/lishu/issues
