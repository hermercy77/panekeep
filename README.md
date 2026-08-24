# Tab Fridge

Local-first browser workspaces for Chrome and Edge on macOS and Windows.

The first release keeps tab metadata local, uses the browser's native tab groups, and only applies AI organization after an explicit user confirmation.

## Development

```bash
npm install
npm run dev
```

Load the generated `.output/chrome-mv3` or `.output/edge-mv3` directory as an unpacked extension.

## Localization

Tab Fridge currently ships Simplified Chinese (`zh-CN`) and English (`en`). Every feature must add and test all supported languages in the same change; see [LOCALIZATION.md](./LOCALIZATION.md).
