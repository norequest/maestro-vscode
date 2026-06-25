# Maestro design tokens (extracted from the approved Claude Design prototype)

Source of truth: `docs/design-reference/Maestro-prototype.html` (the founder's approved
"Maestro AI agents extension" prototype, pulled from claude.ai/design). Every value below
is taken from that file. The first polish pass used a different, warmer graphite and
saturated accents; this file is the correction. Match these exactly.

## Palette (cool graphite, desaturated pastel accents)

Backgrounds (slightly blue/purple cool graphite, NOT neutral grey):
- app / page background: `#161618`
- deep panel / inset: `#1a1a1e`
- surface low: `#202026`, `#222228`
- card: `#26262c` (primary), `#2a2a30` (raised / hover)
- control / raised: `#2e2e36`, `#33333c`

Borders:
- subtle: `#2a2a30`, `#2e2e36`
- default: `#33333c`, `#36363e`
- strong / hover: `#41414a`, `#46464e`

Text:
- primary: `#ededf1`
- secondary: `#cdcdd3`, `#dcdce0`
- tertiary: `#9a9aa2`, `#83838b`
- muted / ghost: `#7a7a82`, `#6c6c74`, `#5e5e66`

Accents (desaturated, soft):
- blue (primary action, active tab, focus): `#8ab8ff`. On-accent text is dark, use `#161618`.
  (A deeper `#4a9eff` appears in one link; prefer `#8ab8ff` as the accent.)
- green (verified, success, adopt check): `#7fd9a8`, deeper `#46c98a`
- amber / gold (attention, likely, needs-you): `#e2b35a`, `#e2a93c` (and `#f0a030`)
- red / salmon (danger, conflict): `#f0848c`

## Mapping from the OLD (wrong) palette to the NEW (prototype) values

Replace these in every `:root` block and in the review `C` constant:

| Role            | OLD (remove)        | NEW (use)                |
|-----------------|---------------------|--------------------------|
| page/stage bg   | #1a1a1a             | #161618                  |
| card            | #242424             | #26262c                  |
| raised          | #2d2d2d             | #2e2e36                  |
| code/inset      | #1e1e1e             | #1a1a1e                  |
| border default  | #3a3a3a             | #33333c                  |
| border hover    | #4a4a4a             | #41414a                  |
| text primary    | #e8e8e8             | #ededf1                  |
| text secondary  | #a0a0a0             | #cdcdd3                  |
| text tertiary   | #6a6a6a             | #83838b                  |
| text ghost      | #5a5a5a             | #6c6c74                  |
| blue accent     | #4a9eff             | #8ab8ff                  |
| green           | #4caf50             | #7fd9a8 (deep #46c98a)   |
| amber           | #f0a030             | #e2b35a                  |
| red             | #e05050             | #f0848c                  |
| on-accent text  | #0a1a2e             | #161618                  |

## Typography

Three families (prototype loads them from Google Fonts):
- body: `'Inter', system-ui, sans-serif`
- display / headings / names: `'Manrope', sans-serif` (weights 600/700/800)
- mono (code, file paths, engine ids, diff, metadata): `'JetBrains Mono', monospace`

Heading example from the prototype: section title = Manrope 700, 16px, `#ededf1`.
Card name = Manrope 700, ~13.5px. Body copy = Inter, 12-13px, `#cdcdd3`.
NOTE on webfonts: the extension webviews do not yet bundle these fonts. For now set the
correct font-family stacks (so it degrades to system sans/mono); actually bundling the
woff2 files is a separate follow-up. Specify Manrope for headings and JetBrains Mono for
all code/paths/engine chips even if it falls back.

## Component conventions (from the prototype)

- Radius: buttons and chips `7px`; cards `8-10px`; pills fully round.
- Secondary button (e.g. "Scan repo"): `background:#222228; border:1px solid #33333c;
  color:#cdcdd3; padding:7px 13px; border-radius:7px; font-size:12px; font-weight:600`,
  hover `background:#2c2c34; border-color:#41414a`.
- Primary button: filled `#8ab8ff`, text `#161618`, weight 600/700.
- Tertiary / "Browse" action: borderless, `background:transparent; border:none;
  color:#7a7a82; font-weight:600`, hover `color:#cdcdd3`.
- Adopt confirmation shows a green check (stroke `#46c98a`).
- Scrollbars: thumb `#34343a`, hover `#46464e`, track transparent, 10px,
  6px radius, 2px transparent border with `background-clip:content-box`.
- Keyframes present in the prototype head: `eqbar` (equalizer mark bars) and `blink`
  (caret). Reuse for any live/working indicator instead of inventing new ones.
- Transitions: keep interactions subtle; ~120-150ms on color/border/background.

## Hard rules (unchanged)

- Graphite only. Never `var(--vscode-*)`.
- No em dashes anywhere. Use commas/periods/colons; middot is fine.
- Keep all `escapeHtml()` calls and all `data-*` / class hooks the webview clients depend on.
- This is presentation only: do not change TS logic, types, exports, or which actions fire.
