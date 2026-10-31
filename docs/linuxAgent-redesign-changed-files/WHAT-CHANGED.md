# linuxAgent UI redesign — what changed and why

Visual-only redesign. No logic, data flow, API calls, or i18n keys were renamed or removed
(one label, `menu`, was **added** for the mobile drawer button; `api.ts` and shared types untouched).

Direction chosen with the user: electric-blue accent `#5b8cff`, medium motion, both themes
designed independently, soft glass. Calm tool-like base, dynamic accents.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/styles.css` | Full rewrite. Design tokens for both themes, glass surfaces, state system, motion, logical properties, mobile drawer, touch targets. |
| `apps/web/src/icons.tsx` | **New.** ~30 inline SVG line icons (stroke = currentColor). No icon dependency, no emoji. |
| `apps/web/src/App.tsx` | Brand mark (terminal glyph in gradient tile), nav icons, mobile drawer (hamburger + scrim + slide), icons in pills/context menu, icon-only `+ new bot` button. All class names and props preserved. |
| `apps/web/src/Chat.tsx` | Run-state chips (icon + colour + label per state), approval card rebuilt as the app's key moment (shield header, command block, equal-weight Allow/Deny with icons, glow pulse on arrival), tool cards with icon/chevron, composer send icon, designed empty state. |
| `apps/web/src/pages.tsx` | Same approval treatment on the Approvals page, designed empty states (approvals/usage/files), folder/download/up icons instead of `📁` emoji, section icons in Settings. |
| `apps/web/src/i18n.tsx` | Additive only: `menu` key (fa + en) for the drawer button. |
| `apps/web/src/main.tsx` | Added Vazirmatn 500 weight import. |
| `apps/web/index.html` | `theme-color` metas for both schemes (mobile browser chrome matches theme). |

## Key design decisions

- **Tokens first.** Every colour/radius/shadow/motion is a custom property; light and dark are
  two separate palettes, not an inversion. Dark: blue-black `#0b0e16` base, electric `#5b8cff`
  accent with dark ink on primary buttons. Light: `#2e63e7` accent (AA on white), crisp surfaces.
- **Approval is unmissable.** Amber border + hairline top light + soft glow pulse (twice, then
  rests), shield badge, command in an LTR mono block, two ≥48px actions: solid green Allow,
  strong red-outline Deny — equal width, both with icons. Colour never carries meaning alone.
- **Eight run states, triple-coded.** queued=cyan/clock, running=blue/activity (breathing),
  waiting_approval=amber/shield, waiting_limit=violet/hourglass, done=green/check,
  failed=red/x, interrupted=orange/pause, cancelled=grey/stop. Colour + icon + label.
- **RTL/LTR from one stylesheet.** Logical properties everywhere (`margin-inline-start: auto`
  puts your messages on the correct side in both directions), direction-aware drawer transform,
  mirrored send/continue icons, direction-aware select chevrons. Code/commands always LTR mono.
- **Dynamic but calm.** Medium motion: hover lift, focus rings, streaming-state breathing,
  approval glow, drawer slide, dialog pop. Everything dies under `prefers-reduced-motion`.
- **Phone first-class.** Sidebar becomes a drawer (scrim + 260ms slide, closes on pick),
  3-row compact topbar (menu/brand/lang · scrollable nav · status pills), 42px+ controls,
  48–50px approval buttons, safe-area-aware composer.
- **Ambient depth, no decoration for its own sake.** One fixed radial accent wash on the body,
  glass only on topbar/chat-head/composer/approval, one gradient rule: brand mark + primary
  action + h2 tick. No stock illustrations, no emoji icons.

## Checked

`fa` (RTL) and `en` (LTR) · light and dark · 1366px desktop and 375px phone · login, chat with a
running/streaming task, approval card (chat + approvals page), usage, files, settings with proxy
section and node list, bot dialog, tool cards expanded, empty chat state. `tsc --noEmit` and
`vite build` pass.

## Demo-only extras (not part of the app)

`mock-server.mjs` — a fake backend + static server for the built `dist/` so you can preview the
redesign without the real server: `node mock-server.mjs` → http://127.0.0.1:8787
(any username / password / 6-digit code signs in).
