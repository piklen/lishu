# Changelog

## Unreleased

- Run extension packaging in CI so release zip generation is verified on pull requests and main.
- Align PRD, launch copy, package metadata, and security policy with the current public release state.
- Add a write-before-preview category quality score with low-confidence, coverage, duplicate-result, and suspicious-category review hints.
- Add a synthetic demo preview that shows the preview workflow without an API key, LLM call, bookmark read, or write action.

## 0.0.3 - 2026-06-18

- Add opt-in dead-link checks to the bookmark health report. The check requests page access first, uses bounded concurrency and timeouts, and never modifies original bookmarks.

## 0.0.2 - 2026-06-18

- Add a README demo GIF that shows configuration, classification, and generated output.
- Add provider examples for OpenAI-compatible, Anthropic, DeepSeek, OpenRouter, LiteLLM, Ollama-compatible, and private gateway setups.
- Add public roadmap issue links and keep one `good first issue` open for contributors.
- Add a category preview step so Lishu classifies first, then writes the output folder only after user confirmation.

## 0.0.1 - 2026-06-18

- Prepare repository for open-source use with MIT license, CI, contributing guide, and security policy.
- Switch broad host access to optional host permissions.
- Add popup recovery actions for clearing progress and deleting the last generated output folder.
- Persist generated output folder id as soon as writing starts, so failed writes can be cleaned up.
