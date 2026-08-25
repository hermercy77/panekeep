# Project instructions

## Localization is part of feature completeness

- PaneKeep supports `zh-CN` and `en`. Every new feature, field, menu item, state, notice, error, tooltip, accessibility label, manifest message, and documentation-facing UI term must ship in both languages in the same change.
- Never hard-code user-facing copy in components or application logic. Add a typed key to `src/i18n/catalog.ts`, then add both locale values and render it through the shared i18n helpers.
- Any AI-generated user-visible workspace name, description, or tag must follow the currently selected `AppLanguage`. Preserve this language parameter through every new AI pipeline or prompt path.
- Manifest copy belongs in every directory under `public/_locales`.
- A feature is incomplete until `npm run test:i18n`, the full test suite, typecheck, and both Chrome and Edge builds pass.
- Follow the detailed checklist in `LOCALIZATION.md`.
