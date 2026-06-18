# Contributing

Thanks for helping improve Lishu.

## Development Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
bash scripts/check-secrets.sh
```

Load `dist/` through `chrome://extensions` to test the extension manually.

## Pull Request Checklist

- Keep the extension non-destructive: do not move, edit, or delete original bookmarks.
- Do not add a backend, telemetry, or bundled API key.
- Keep permissions minimal. If a feature needs broader access, explain why in the PR.
- Add or update tests for core behavior.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a PR.
- Run `bash scripts/check-secrets.sh` before publishing a release or making the repository public.

## Code Style

- TypeScript only.
- Keep popup UI lightweight; no React or large UI framework unless there is a clear reason.
- Prefer small pure helpers in `src/core/` and `src/providers/` with focused tests.
- User-facing runtime messages may be Chinese or English, but keep security and permission wording explicit.

## Good First Contributions

- New OpenAI-compatible provider examples in docs.
- Better error messages for common endpoint and model configuration mistakes.
- Small popup UX improvements.
- Tests around permission and recovery flows.
