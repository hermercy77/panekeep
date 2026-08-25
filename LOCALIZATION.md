# Localization rule

PaneKeep ships every user-facing feature in all supported languages at the same time.

Current locales:

- `zh-CN` — Simplified Chinese
- `en` — English

Required for every new feature, state, field, action, notice, error, tooltip, accessibility label, and AI instruction:

1. Add one typed key to `src/i18n/catalog.ts`.
2. Add both the `zh-CN` and `en` value in the same change.
3. Render UI copy through `useI18n().t(...)`; non-React code uses `translate(getAppLanguage(), ...)`.
4. If AI generates user-visible metadata, pass the current `AppLanguage` into its prompt and test the requested output language.
5. Update `_locales` when extension-manifest copy changes.
6. Add or update tests for both languages. A feature is incomplete if either locale is missing.

Run before merging:

```bash
npm run typecheck
npm run test:i18n
npm test -- --run
npm run build
npm run build:edge
```

The typed English catalog prevents missing keys, while the localization guard test rejects Simplified Chinese copy outside the catalog. Review must also reject newly hard-coded English UI copy.
