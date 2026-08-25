# Tab Fridge

Local-first browser workspaces for Chrome and Edge on macOS and Windows.

> The project is preparing its first public release. Install unpacked builds only in a test browser profile until the release checklist and native-browser acceptance are complete.

The first release keeps tab metadata local, uses the browser's native tab groups, and only applies AI organization after an explicit user confirmation.

AI settings include curated presets for common global and mainland-China providers, plus a Custom OpenAI-compatible option. Anthropic uses its native Messages API; the other presets use OpenAI Chat Completions compatibility. A connection test loads the provider's current model list when available, and model IDs can always be entered manually.

## Development

```bash
npm install
npm run dev
```

Load the generated `.output/chrome-mv3` or `.output/edge-mv3` directory as an unpacked extension.

## Localization

Tab Fridge currently ships Simplified Chinese (`zh-CN`) and English (`en`). Every feature must add and test all supported languages in the same change; see [LOCALIZATION.md](./LOCALIZATION.md).

## AI evaluation

Run `npm run eval:ai` for the browser-free deterministic suite, or use `npm run eval:ai:live` to measure an OpenAI-compatible provider against the synthetic 20–50 tab benchmark. See [AI_EVALS.md](./AI_EVALS.md).

## Project policies

- [Privacy policy / 隐私政策](./PRIVACY.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)

An open-source license will be added before the first public release. Until then, publication of this repository does not grant permission to copy, modify, or redistribute the code.
