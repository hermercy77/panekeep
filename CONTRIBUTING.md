# Contributing to Tab Fridge

Thank you for helping improve the project. Changes should stay focused on the extension's single purpose: local-first browser tab workspaces with optional, user-initiated AI organization.

## Development

Requirements:

- Node.js 22.12 or newer
- npm
- Chrome or Edge for native extension testing

Install and start development:

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run typecheck
npm run test:i18n
npm test -- --run
npm run build
npm run build:edge
```

## Localization

Every user-visible change must ship in both Simplified Chinese (`zh-CN`) and English (`en`) in the same pull request. Follow [LOCALIZATION.md](./LOCALIZATION.md); do not hard-code user-facing copy in components or application logic.

## Privacy and browser state

- Request only the narrowest browser permissions needed by existing features.
- Never log, export, commit, or include API keys in test fixtures.
- Keep remote AI requests user-initiated and disclose the exact metadata sent.
- Treat tab titles and URLs as untrusted data.
- Preserve snapshot validation, all-or-nothing mutation, and rollback behavior for operations that change browser state.
- Add tests for cross-window, pinned-tab, closed-tab, stale-preview, and rollback cases when relevant.

## Pull requests

- Keep each pull request reviewable and explain its user-visible outcome.
- Include tests and both locales with feature changes.
- Call out permission, privacy, storage-schema, and backup-format changes explicitly.
- Include real Chrome or Edge verification notes for browser-native behavior.
- Do not include generated `.output`, `.wxt`, coverage, or local evaluation artifacts.

By contributing, you agree that your contribution is provided under the repository's license once that license is adopted.
