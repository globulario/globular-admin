# CSS Token Contract

All Globular apps share the design-token layer defined in `@globular/ui/styles/theme.css`.
Import it as the first stylesheet in your app entry point:

```ts
import '@globular/ui/styles/theme.css'
import '@globular/ui/styles/components.css' // optional MD3 component classes
import '@globular/ui/styles/base.css'       // optional shared layout
```

## Token Reference

### MD3 Shape Scale

| Token | Default |
|-------|---------|
| `--md-shape-xs` | `4px` |
| `--md-shape-sm` | `8px` |
| `--md-shape-md` | `12px` |
| `--md-shape-lg` | `16px` |
| `--md-shape-xl` | `28px` |
| `--md-shape-full` | `9999px` |

### MD3 Surface Container Hierarchy

| Token | Light | Dark |
|-------|-------|------|
| `--md-surface-container-lowest` | `#fafbfc` | `#0a0d10` |
| `--md-surface-container-low` | `#ffffff` | `#171b21` |
| `--md-surface-container` | `#f3f4f7` | `#1c2028` |
| `--md-surface-container-high` | `#eceef2` | `#1f252f` |
| `--md-surface-container-highest` | `#e5e8ed` | `#252c38` |

### Core Colour Roles

| Token | Light | Dark |
|-------|-------|------|
| `--background-color` | `#f6f7f9` | `#0f1216` |
| `--surface-color` | container-low | container-low |
| `--surface-elevated-color` | container-high | container-high |
| `--on-surface-color` | `#1d2025` | `#e5e7eb` |
| `--primary-color` | `#3b82f6` | `#1f1e1e` |
| `--accent-color` | `#3b82f6` | `#60a5fa` |
| `--on-primary-color` | `#ffffff` | `#ffffff` |
| `--secondary-color` | `#26a69a` | cyan-mix |
| `--error-color` | `#ef4444` | `#f87171` |
| `--success-color` | `#10b981` | `#34d399` |

### State Layers

| Token | Description |
|-------|-------------|
| `--md-state-hover` | 8% on-surface overlay |
| `--md-state-focus` | 12% on-surface overlay |
| `--md-state-pressed` | 12% on-surface overlay |
| `--md-state-selected` | 12% accent overlay |

### Elevation Shadows

| Token | Description |
|-------|-------------|
| `--md-elevation-0` | none |
| `--md-elevation-1` | subtle card shadow |
| `--md-elevation-2` | dialog/modal shadow |
| `--md-elevation-3` | raised element shadow |

### Typography Scale

All tokens use CSS `font` shorthand: `weight size/line-height family`.

| Token | Value |
|-------|-------|
| `--md-typescale-headline-large` | `800 32px/1.25 inherit` |
| `--md-typescale-headline-medium` | `800 28px/1.29 inherit` |
| `--md-typescale-headline-small` | `700 24px/1.33 inherit` |
| `--md-typescale-title-large` | `600 22px/1.27 inherit` |
| `--md-typescale-title-medium` | `500 16px/1.5 inherit` |
| `--md-typescale-title-small` | `500 14px/1.43 inherit` |
| `--md-typescale-body-large` | `400 16px/1.5 inherit` |
| `--md-typescale-body-medium` | `400 14px/1.43 inherit` |
| `--md-typescale-body-small` | `400 12px/1.33 inherit` |
| `--md-typescale-label-large` | `500 14px/1.43 inherit` |
| `--md-typescale-label-medium` | `500 11px/1.45 inherit` |
| `--md-typescale-label-small` | `500 10px/1.60 inherit` |

### Border / Divider

| Token | Description |
|-------|-------------|
| `--border-subtle-color` | 10% on-surface (light) / 18% (dark) |
| `--border-strong-color` | 22% on-surface (light) / 32% (dark) |
| `--divider-color` | alias for border-subtle |

### Legacy Palette Aliases

These map to the appropriate MD3 tokens for backward compatibility with existing Polymer components:

`--palette-background`, `--palette-background-dark`, `--palette-background-paper`,
`--palette-primary`, `--palette-primary-main`, `--palette-primary-light`, `--palette-primary-dark`,
`--palette-primary-contrast`, `--palette-primary-accent`, `--palette-text-primary`,
`--palette-text-secondary`, `--palette-text-accent`, `--palette-error-main`,
`--palette-success-main`, `--palette-divider`, `--palette-action-active`, `--palette-action-disabled`

## Component Classes (`components.css`)

Import `@globular/ui/styles/components.css` for ready-made MD3 component classes:

- `.md-badge` — status badge with `--badge-color`
- `.md-chip` / `.md-chip-tonal` / `.md-chip-success` / `.md-chip-error` / `.md-chip-warn` / `.md-chip-neutral`
- `.md-panel` / `.md-panel-header` — card with title bar
- `.md-table` / `.md-row` / `.md-interactive` — data table
- `.md-btn` / `.md-btn-filled` / `.md-btn-tonal` / `.md-btn-outlined` / `.md-btn-text` / `.md-btn-sm` / `.md-btn-danger` / `.md-btn-success`
- `.md-input` — text field
- `.md-banner-warn` / `.md-banner-error`
- `.md-stat-card` / `.md-stat-label` / `.md-stat-value`
- `.md-empty` — empty-state italic text
- `.md-page-wrap` / `.md-page-header` / `.md-page-title` / `.md-page-subtitle`
