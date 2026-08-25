# PaneKeep release checklist

Do not mark a release ready from automated checks alone. Complete every applicable item and attach evidence to the GitHub Release or Chrome Web Store submission notes.

## Code and localization

- [ ] Working tree is clean and the release commit is on `origin/main`.
- [ ] `npm ci` completes using a supported Node.js version.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test:i18n` passes.
- [ ] `npm test -- --run` passes.
- [ ] `npm run eval:ai` passes.
- [ ] `npm audit --audit-level=low` reports zero vulnerabilities.
- [ ] Chrome and Edge production builds pass.
- [ ] Generated manifests contain only reviewed permissions and include all icon sizes.
- [ ] Every user-visible term and manifest message is complete in `zh-CN` and `en`.

## Privacy and security

- [ ] [PRIVACY.md](./PRIVACY.md), dashboard declarations, store copy, and actual behavior agree.
- [ ] The AI dialog identifies the configured destination and data fields before transmission.
- [ ] Public AI endpoints require HTTPS; only local loopback endpoints may use HTTP.
- [ ] No developer telemetry, analytics, advertising, or remote executable code is present.
- [ ] Secret scanning and push protection are enabled.
- [ ] Dependabot has no unresolved security alert affecting the release.
- [ ] A fresh secret scan finds no key, token, private key, or private browsing fixture in Git history.

## Native Chrome acceptance

- [ ] Load the unpacked Chrome build in a fresh test profile with no console or service-worker errors.
- [ ] Toolbar action opens and closes the side panel.
- [ ] Side panel and management page render in both languages and system light/dark modes.
- [ ] Create, edit, reorder, and delete a workspace.
- [ ] Move one tab and multiple selected tabs within one window.
- [ ] Move tabs across windows and verify empty-window behavior.
- [ ] Drag near panel edges and verify auto-scroll and cancel-drop behavior.
- [ ] Merge workspaces in the same window and across windows.
- [ ] Verify pinned tabs are excluded by default and explicitly unpinned when selected for a move.
- [ ] Verify special pages remain protected.
- [ ] Export a backup, import it into non-empty browser state, and verify rollback on a forced failure.
- [ ] Restart Chrome and verify state reconstruction and service-worker wake-up.
- [ ] Deny an optional AI host permission and verify a clear, localized error.
- [ ] Test invalid key, unavailable model, timeout, provider error, stale preview, and closed-tab conflict.
- [ ] Verify AI requests send only the fields disclosed in the UI and privacy policy.

## Native Edge acceptance

- [ ] Load the unpacked Edge build in a fresh test profile.
- [ ] Repeat the Chrome smoke path for side panel, native groups, drag/drop, backup, restart, and AI permission denial.
- [ ] Record the tested Edge version and operating system.

## Store assets and account

- [ ] Store icon is 128×128 PNG and package icons are present at 16/32/48/128.
- [ ] At least one current 1280×800 screenshot exists for each published locale; target 3–5.
- [ ] English and Chinese 440×280 small promo tiles are ready.
- [ ] Store summary, description, category, support URL, homepage, and privacy URL are filled.
- [ ] Single-purpose, permission, data-use, and remote-code fields match [STORE_LISTING.md](./STORE_LISTING.md).
- [ ] Developer account email is verified and two-step verification is enabled.
- [ ] The initial item is submitted as Private / Trusted testers.

## Version and publication

- [ ] `package.json` and generated manifest use the intended monotonically increasing version.
- [ ] Chrome and Edge ZIP archives are generated from the same clean release commit.
- [ ] Archive contents are inspected; no source maps, secrets, test fixtures, or unrelated files are included.
- [ ] A signed Git tag and GitHub Release include checksums and acceptance evidence.
- [ ] Trusted-tester feedback is resolved or explicitly deferred before public visibility.
