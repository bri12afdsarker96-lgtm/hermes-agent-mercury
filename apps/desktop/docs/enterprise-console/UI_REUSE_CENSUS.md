# UI Reuse Census — Enterprise Desktop Visual Baseline v1

Lane B-UI. Base functional head: `377e69aae8a3b545a6f58bf2842e3f61c9a2de08` (PR #8).

The approved design ships as a standalone HTML/CSS/JSX package with ~30 React
components and 246 `:root` CSS custom properties. **The visual design is frozen
and approved; the design package's *source code* is not authoritative
implementation code.** This document records which of those components already
had an owner in this app, and is the justification for the small set of files
actually added.

The governing rule is `DESIGN.md`: *"One primitive per concern. One `Button`,
one set of control variants, one `SearchField`, one `Loader`, one `ErrorState`.
Migrate onto them; don't fork."* Desktop `AGENTS.md` adds *"Keep the waist
narrow… design a shared contract only once more than one real consumer proves
its shape."*

Result: **27 of 30 adopt. 3 are new.**

## Adopt — already exported by `@hermes/plugin-sdk`

Import these from the SDK. Do not re-implement them, and do not wrap them
merely to rename a prop.

| Design component | Owner |
| --- | --- |
| Button | `components/ui/button.tsx` — 8 variants × 11 sizes, a superset of the design's |
| IconButton | `Button size="icon" \| "icon-xs" \| "icon-sm" \| "icon-lg"`. A separate component is the fork DESIGN.md forbids |
| Input / Textarea / Select | `components/ui/{input,textarea,select}.tsx`, all on shared `controlVariants` |
| SearchField | `components/ui/search-field.tsx` |
| SegmentedControl | `components/ui/segmented-control.tsx` |
| Switch | `components/ui/switch.tsx` (`size="xs"`) |
| StatusBadge | `components/ui/badge.tsx` + `components/status-dot.tsx` |
| Tabs | `components/ui/tabs.tsx` |
| Loader | `components/ui/loader.tsx` |
| Skeleton | `components/ui/skeleton.tsx` (+ `CountSkeleton`) |
| EmptyState | `components/ui/empty-state.tsx` |
| ErrorState | `components/ui/error-state.tsx` (+ `ErrorIcon`, `ErrorBanner`) |
| LogView | `components/ui/log-view.tsx` |
| Tip / Tooltip | `components/ui/tooltip.tsx` — Radix, with collision handling the design package's absolutely-positioned span does not have |
| Dialog | `components/ui/dialog.tsx` — Radix, plus `dialog-portal-context.ts` so nested Select/Popover portal *into* the dialog |
| ConfirmDialog | `components/ui/confirm-dialog.tsx` — owns the idle→saving→done beat |
| Drawer | `components/ui/sheet.tsx`. A sheet **is** a drawer |
| DetailPanel | `app/master-detail.tsx` / `app/overlays/overlay-split-layout.tsx` |
| Icons | `lib/icons.ts` (Tabler, curated) via the SDK's `icons`; `Codicon` for editor/tool/status glyphs |

## Adopt — already built inside this plugin

| Design component | Owner |
| --- | --- |
| PageStatusBadge | `status-badge.tsx` — takes the real `PageStatus` from `catalog.ts` |
| CapabilityChip | `status-badge.tsx` → `CapabilityBadge` — takes the real `CapabilityStatus` from `types.ts` and is already wired to `whoami.product_capabilities` |

The design package widens both vocabularies (`PARTIAL`/`BLOCKED`/`UNAVAILABLE`
on the capability chip; `denied`/`pending` on the page badge). Those extra
values are not producible by `capabilityStatus()`, and `denied`/`pending` are
*page components* in `page-placeholder.tsx`, not statuses. The server's
vocabulary wins; the chips are not widened to match a drawing.

## Adopt — host-owned, reached through contribution areas

Shell chrome is **not** rebuilt. The console is a route inside the app's one
shell and already contributes to it.

| Design component | Seam |
| --- | --- |
| AppSidebar | `SIDEBAR_NAV_AREA` — the plugin already registers a nav row |
| TopHeader | `TITLEBAR_AREAS` (`titleBar.left/center/right`) |
| StatusBar | `STATUSBAR_AREAS` (`statusBar.left/right`) — status content is contributed, not re-housed in a second bar |
| BrandMark | `components/brand-mark.tsx`, rendering the real `hermes-agent-logo.svg` |
| Toast / ToastStack | `host.notify` / `host.notifyError` over `store/notifications.ts`. There is no toast library and none is added |

## New — justified

Three, all scoped to this plugin rather than promoted to `components/ui/`,
because only one consumer exists. Promote them if a second one appears.

| Component | Why nothing existed |
| --- | --- |
| `ui/kpi-card.tsx` | No stat tile anywhere. Encodes two product rules: a missing figure renders `—` (never `0`), and a figure always carries its baseline comparison |
| `ui/data-table.tsx` | No table primitive and no table library — deliberately. Plain semantic `<table>`; no sorting, virtualization, resizing or pagination, so it cannot grow into an engine |
| `ui/timeline.tsx` | The two existing timelines are the chat transcript and the starmap scrubber — neither is a generic event record |

Plus `ui/panel.tsx` (`ConsolePanel`, `PageHeader`) — thin layout containers for
the approved card and page-title geometry, named to avoid colliding with the
overlay `Panel` family.

## Deliberately not ported

These are properties of the design package's delivery, not of the approved
design. Porting any of them was rejected.

| Artifact | Why |
| --- | --- |
| `tokens/*.css` on `:root` | Redefines `--ui-*` as flat light-only literals in **unlayered** CSS. Unlayered beats `@layer base` unconditionally, so importing it would override the theme engine app-wide and silently kill dark mode and every user theme. The `--ec-*` layer in `ui/console.css` is scoped and derives from the app's own tokens instead |
| `tokens/layout.css` z-index ladder | Same names, different numbers (`--z-modal: 910` vs the app's `130`), and omits seven rungs. Would bury the session switcher under every dialog |
| Inline `style={}` component system | Highest-specificity declarations — no theme, `.dark` variant or user skin can override them. Permanently un-themeable |
| JS hover state (`useState` + `onMouseEnter`) | Re-renders on every mouse-over, on the app's hottest interaction. CSS `:hover` costs nothing |
| Tabler webfont from `cdn.jsdelivr.net` | Runtime CDN in an Electron renderer that must work offline, at a different version from the pinned `@tabler/icons-react`. The design package's own README calls this a delivery substitution |
| `_ds_bundle.js`, `_ds_manifest.json`, `window.HermesEnterpriseDesktopDesignSystem_89ae01` | Design-tool preview runtime and global namespace |
| `_adherence.oxlintrc.json` | An **oxlint** config; this repo runs ESLint |
| `ui_kits/**/data.js` | Fabricated business data (王琳 / 4031群 / ¥500). `DESIGN_PREVIEW_ONLY` — fixtures and visual harness only, never a runtime path |
| `fonts/` — RTWS ShangGo G0 | 13 MB of TTFs for a commercial CJK family with **no licence file anywhere in the package**. Rejected for distribution. Replaced by exact Adobe Source Han Sans CN under OFL-1.1 — see below |
| `assets/brand/*.png` | Brand marks traced from AI renders, no vector master. The app ships a real logo |

## Typography

The design's brand face is rejected for licensing. The approved replacement is
**Source Han Sans CN (思源黑体)** from Adobe's official `adobe-fonts/source-han-sans`
release **2.005R**. The bundled file is the official CN region-specific variable
WOFF2 at `Variable/WOFF2/OTF/Subset/SourceHanSansCN-VF.otf.woff2`, stored locally
as `src/fonts/SourceHanSansCN-VF.woff2`; the upstream Git blob SHA is
`f87772cec1747734cbea16204ae99e4f2cc06713`. The accompanying Adobe OFL-1.1
license is `src/fonts/LICENSE-SourceHanSansCN.txt` (upstream blob
`3ff0ccaba06857bf292ade9a50f16a0f02b3b8d4`). No runtime CDN is used.

One variable file covers the approved UI's 400–700 weights and avoids shipping
duplicate static CJK font binaries. Only the Enterprise Console opts in through
`ui/console.css`; core Mercury typography remains unchanged. No substitute font
is renamed or aliased to the Source Han family.

## Function truth is unchanged by this layer

All 13 pages in `catalog.ts` were re-verified against the design package's truth
matrix at the base head above. They match exactly — `followup`, `wecom` and
`audit` remain `blocked`/`missing`; `conversations` `partial`/`missing`;
`identity` and `usage` partial. **This layer is presentation only.** It adds no
transport, no permission logic and no capability claim, and nothing here may be
read as evidence that a blocked capability has landed.
