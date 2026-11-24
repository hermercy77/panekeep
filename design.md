# Design — PaneKeep

A locked design system for the browser extension. Side panel and management page
share this Warm Editorial Paper system; individual pages may vary density, never
palette or typography.

## Genre

warm-editorial — tactile paper ledger, calm, bookish, exact.

## Macrostructure family

- App pages: Editorial Ledger. Function is the proof; clear ink rules and terracotta index tabs organize dense workspace controls.
- Side panel: compact paper instrument rail with one forest-green primary action (`AI Organize`) and explicit window/workspace hierarchy.
- Management page: side index rail + continuous bound-ledger surface featuring inline accordion AI profiles and side-by-side backup cards.

## Theme

Warm oat/ivory paper with charcoal ink, forest-green active accents, and terracotta section index tabs. Dark mode shifts to warm espresso paper with moss-green and muted terracotta accents following `prefers-color-scheme: dark`.

- `--color-paper`: warm oat/ivory (`#f6f2e9`)
- `--color-surface`: cream paper (`#faf7f0`)
- `--color-ink`: warm charcoal (`#241f1a`)
- `--color-accent`: forest green (`#3d5d42`) for active states, primary CTA, and AI Organize
- `--color-terracotta`: terracotta (`#a76349`) for editorial folder-tab headings and brand leaf mark
- `--color-rule-strong`: warm ink double-rule divider (`#c2b59f`)

## Typography

- Display / Headings: Chinese Song serif (`Songti SC` / `Noto Serif SC` / `Georgia`, roman, bold)
- Body / Controls: `IBM Plex Sans Variable` + Chinese system sans (`PingFang SC`, `Microsoft YaHei`)
- Mono / Counts & Domains: `JetBrains Mono Variable` (tabular numerals)

## Spacing & Motion

- 4-point named scale defined in `tokens.css` (single source of truth).
- Motion-cut by default: subtle press feedback on buttons, opacity + `0.98 → 1` on modals, reduced motion respects `prefers-reduced-motion: reduce`.

## Brand Mark

Two folded leaves (`BrandMark.tsx`): terracotta left page + forest-green right page, shared by both the side panel and management header.
