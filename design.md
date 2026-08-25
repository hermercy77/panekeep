# Design — PaneKeep

A locked design system for the browser extension. Side panel and management page
share this system; individual pages may vary density, never theme or typography.

## Genre

modern-minimal — technical, calm, exact.

## Macrostructure family

- App pages: Workbench. Function is the proof; dense controls sit inside a strong grid.
- Side panel: compact instrument rail with one primary action and explicit hierarchy.
- Management page: side rail + continuous work surface, not a dashboard card grid.

## Theme

Cobalt on tinted light paper. Accent is a signal, never a large fill. Dark mode
uses the same hue and hierarchy on graphite paper and follows the system setting.

- `--color-paper`: cool near-white
- `--color-ink`: blue-black
- `--color-accent`: electric cobalt
- `--color-focus`: lighter cobalt with contrast on paper and controls
- Dark mode: Cobalt graphite, activated by `prefers-color-scheme: dark`

## Typography

- Display: Space Grotesk Variable, weight 650, roman
- Body: IBM Plex Sans Variable, weight 400
- Mono: JetBrains Mono Variable, weight 500; technical labels only
- Headings use tight tracking; body remains at normal tracking

## Spacing

4-point named scale defined in `tokens.css`. Raw spacing values are not introduced
inside component rules.

## Motion

- Motion-cut by default
- Buttons: press feedback only
- Dialogs: opacity + 0.98 → 1 scale
- Dragging: opacity and explicit drop rule
- Reduced motion: opacity only, ≤ 150 ms

## Microinteractions stance

- Silent success when the result is already visible
- Focus appears immediately
- Hover is always paired with focus-visible
- Loading is inline and keeps the action label legible

## CTA voice

- Primary: dark ink fill, compact rectangular control, specific verb
- AI action: cobalt outline/signal, never a large accent-filled area
- Secondary: paper surface with visible rule

## Per-page allowances

- Side panel prioritises density and rapid scanning.
- Management page prioritises configuration clarity and horizontal breathing room.
- No decorative enrichment. The application state carries the page.

## What pages MUST share

- Wordmark, typography, cobalt signal accent and focus treatment
- 44 px primary control height
- 6–8 px radii and ruler-like borders
- Window/workspace colour semantics
- Error, success, loading and disabled state language

## What pages MAY differ on

- Side panel uses compact list rows; management uses continuous sections
- Management can use a wider content measure and sticky side rail
- Dialog width follows task complexity

## Exports

`tokens.css` at the project root is the source of truth. These translations keep
the same semantic roles when the system is reused elsewhere.

### CSS custom properties

```css
@import "./tokens.css";

:root {
  --color-paper: oklch(98.2% 0.006 252);
  --color-paper-2: oklch(96.2% 0.010 252);
  --color-paper-3: oklch(93.5% 0.014 252);
  --color-surface: oklch(99.1% 0.004 252);
  --color-ink: oklch(21% 0.025 255);
  --color-ink-2: oklch(36% 0.025 255);
  --color-neutral: oklch(50% 0.020 255);
  --color-muted: oklch(54% 0.018 255);
  --color-subtle: oklch(55% 0.014 255);
  --color-rule: oklch(87% 0.014 252);
  --color-accent: oklch(55% 0.205 258);
  --color-accent-ink: oklch(98% 0.008 252);
  --color-focus: oklch(67% 0.165 250);
  --font-display: "Space Grotesk Variable", "Avenir Next", sans-serif;
  --font-body: "IBM Plex Sans Variable", "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono Variable", "SFMono-Regular", monospace;
  --space-3xs: 0.125rem;
  --space-2xs: 0.25rem;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;
  --space-3xl: 6rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.25rem;
  --text-lg: 1.5rem;
  --text-xl: 2rem;
  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-micro: 100ms;
  --dur-short: 180ms;
  --dur-long: 280ms;
}
```

Dark values remain under `@media (prefers-color-scheme: dark)` in
`tokens.css`; consumers should preserve that media-query boundary.

### Tailwind v4

```css
@theme {
  --color-paper: oklch(98.2% 0.006 252);
  --color-paper-2: oklch(96.2% 0.010 252);
  --color-paper-3: oklch(93.5% 0.014 252);
  --color-surface: oklch(99.1% 0.004 252);
  --color-ink: oklch(21% 0.025 255);
  --color-ink-2: oklch(36% 0.025 255);
  --color-muted: oklch(54% 0.018 255);
  --color-accent: oklch(55% 0.205 258);
  --color-accent-ink: oklch(98% 0.008 252);
  --color-focus: oklch(67% 0.165 250);
  --font-display: "Space Grotesk Variable", sans-serif;
  --font-body: "IBM Plex Sans Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
  --spacing-3xs: 0.125rem;
  --spacing-2xs: 0.25rem;
  --spacing-xs: 0.5rem;
  --spacing-sm: 0.75rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2.5rem;
  --spacing-2xl: 4rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.5rem;
  --text-xl: 2rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.2% 0.006 252)", "$type": "color" },
    "paper-2": { "$value": "oklch(96.2% 0.010 252)", "$type": "color" },
    "paper-3": { "$value": "oklch(93.5% 0.014 252)", "$type": "color" },
    "surface": { "$value": "oklch(99.1% 0.004 252)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.025 255)", "$type": "color" },
    "ink-2": { "$value": "oklch(36% 0.025 255)", "$type": "color" },
    "muted": { "$value": "oklch(54% 0.018 255)", "$type": "color" },
    "accent": { "$value": "oklch(55% 0.205 258)", "$type": "color" },
    "accent-ink": { "$value": "oklch(98% 0.008 252)", "$type": "color" },
    "focus": { "$value": "oklch(67% 0.165 250)", "$type": "color" }
  },
  "font": {
    "display": { "$value": ["Space Grotesk Variable", "Avenir Next", "sans-serif"], "$type": "fontFamily" },
    "body": { "$value": ["IBM Plex Sans Variable", "Segoe UI", "sans-serif"], "$type": "fontFamily" },
    "mono": { "$value": ["JetBrains Mono Variable", "SFMono-Regular", "monospace"], "$type": "fontFamily" }
  },
  "size": {
    "text-xs": { "$value": "0.75rem", "$type": "dimension" },
    "text-sm": { "$value": "0.875rem", "$type": "dimension" },
    "text-base": { "$value": "1rem", "$type": "dimension" },
    "text-lg": { "$value": "1.5rem", "$type": "dimension" },
    "text-xl": { "$value": "2rem", "$type": "dimension" }
  },
  "space": {
    "3xs": { "$value": "0.125rem", "$type": "dimension" },
    "2xs": { "$value": "0.25rem", "$type": "dimension" },
    "xs": { "$value": "0.5rem", "$type": "dimension" },
    "sm": { "$value": "0.75rem", "$type": "dimension" },
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" },
    "xl": { "$value": "2.5rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "100ms", "$type": "duration" },
    "short": { "$value": "180ms", "$type": "duration" },
    "long": { "$value": "280ms", "$type": "duration" }
  }
}
```

### shadcn/ui

```css
:root {
  --background: 98.2% 0.006 252;
  --foreground: 21% 0.025 255;
  --card: 99.1% 0.004 252;
  --card-foreground: 21% 0.025 255;
  --popover: 99.1% 0.004 252;
  --popover-foreground: 21% 0.025 255;
  --primary: 55% 0.205 258;
  --primary-foreground: 98% 0.008 252;
  --secondary: 93.5% 0.014 252;
  --secondary-foreground: 36% 0.025 255;
  --muted: 87% 0.014 252;
  --muted-foreground: 54% 0.018 255;
  --accent: 55% 0.205 258;
  --accent-foreground: 98% 0.008 252;
  --destructive: 54% 0.190 28;
  --destructive-foreground: 98% 0.008 252;
  --border: 87% 0.014 252;
  --input: 77% 0.022 252;
  --ring: 67% 0.165 250;
  --radius: 0.375rem;
}

.dark {
  --background: 14.5% 0.018 255;
  --foreground: 94% 0.010 252;
  --card: 18.5% 0.021 255;
  --card-foreground: 94% 0.010 252;
  --popover: 22% 0.024 255;
  --popover-foreground: 94% 0.010 252;
  --primary: 69% 0.165 253;
  --primary-foreground: 15% 0.020 255;
  --secondary: 21% 0.023 255;
  --secondary-foreground: 82% 0.014 252;
  --muted: 29% 0.025 255;
  --muted-foreground: 62% 0.017 252;
  --accent: 69% 0.165 253;
  --accent-foreground: 15% 0.020 255;
  --destructive: 70% 0.145 25;
  --destructive-foreground: 15% 0.020 255;
  --border: 29% 0.025 255;
  --input: 39% 0.035 255;
  --ring: 75% 0.145 247;
}
```
