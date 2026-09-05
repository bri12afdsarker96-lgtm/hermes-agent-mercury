# Enterprise Desktop visual-authority realignment

## Decision

`Hermes Enterprise Desktop` is a distinct Chinese enterprise product. Its
visual authority is the product-owned design system at:

`D:\GitHub\Hermes Enterprise Desktop Design System`

This is not a skin applied to the upstream Hermes client. Hermes is reused as
the Electron/runtime/transport substrate and as an AI capability; it is not the
source for product navigation, page composition, copy, visual tokens, or visual
test expectations.

## Authoritative sources

| Concern | Authoritative source |
| --- | --- |
| Shell geometry, colours, typography, spacing and state tokens | `tokens/*.css` and `components/**` in the Enterprise Desktop Design System |
| Brand asset and typography reference | `assets/brand/**` and the type rules in the Enterprise Desktop Design System; runtime distribution uses licensed HarmonyOS Sans SC |
| Login, role workbenches and business-page composition | `ui_kits/enterprise-desktop/*.jsx` and `refs/ref1-login.png` through `refs/ref7-conversations.png` |
| Data truth, capability state and unavailable behaviour | `TRUTH_MATRIX.md`, current Hermes_AI contracts, and the desktop catalog/controllers |
| Electron lifecycle, IPC, token custody and transport | existing Mercury Electron/main-process bridge |
| Tenant, identity, role and permission decisions | Hermes_AI `whoami` and server-side authorization only |

Reference kit fixtures are design previews only. Production views must never
copy their people, counts, conversations, timestamps, or business records.

## What may be reused, and what must be replaced

| Area | Reuse | Replace / realign |
| --- | --- | --- |
| Electron application | Window lifecycle, native auth, secure IPC, update/runtime boot | Product title/first paint and all enterprise presentation |
| Server integration | `EnterpriseClientRuntime`, `IpcHermesTransport`, query controllers, response/error semantics | No renderer-direct fetch, no client-local authority, no invented data |
| Identity and access | Server `whoami`, effective permissions, server-side deny behaviour | Chinese role labels and role-specific navigation derived from server facts |
| Enterprise pages | Existing page controllers, view-models, mutation safeguards, a11y and responsive test semantics | Layout, component composition, wording, token use and screenshots |
| AI assistant | Existing agent/runtime capability | It is a Chinese enterprise workbench destination, never the product root or upstream chat shell |
| Visual tests | Electron fixture lifecycle, viewport assertions, real mocked server contract | The old English/upstream screenshot set and selectors that enter the old client shell |

## Explicitly rejected visual sources

The following cannot define the shipped Enterprise UI or its expected
screenshots:

- The generic Hermes chat/session/sidebar chrome.
- The legacy `/console` shell when it presents `Enterprise Console`, an
  English navigation landmark, or the upstream assistant shell.
- Existing visual snapshots named `enterprise-operator-home-*` that capture
  that legacy frame.
- Local CSS which approximates the reference with copied raw hex values rather
  than the owned semantic tokens.

They remain useful only as a source of non-visual regression semantics (for
example: secure session recovery, permission denial, viewport setup and
accessibility checks).

## Product information architecture

The shared shell is the owned `Titlebar (44px) + AppSidebar + TopHeader (56px)
+ StatusBar (40px)` composition. It has a Chinese first paint, self-hosted
HarmonyOS Sans SC type, owned mark, light enterprise token palette, and no
upstream chat/session rail.

The server's raw role is never trusted as a layout shortcut; it is a display
mapping plus permission-filtered page set:

| Server role | Chinese display | Owned reference workbench | Navigation basis |
| --- | --- | --- | --- |
| `operator` | 员工 | `ref2-operator-home.png` | Server permissions; personal work destinations |
| `supervisor` | 主管 | `ref3-supervisor-home.png` | Server permissions; team work, review and takeover destinations |
| `tenant_admin` | 企业管理员 | `ref4-admin-overview.png` | Server permissions; tenant operations and employee/permission destinations |
| `super_admin` | 平台管理员 | Admin composition with explicit tenant scope | Server permissions and explicit server-selected tenant scope |

An unknown role receives a safe Chinese “权限正在确认” state; it does not
inherit administrator navigation. A page may be visible only when its catalog
and the effective permissions allow it. Capability chips and disabled controls
must continue to state `DEV`, `PARTIAL`, `BLOCKED` or unavailable truthfully.

## Implementation order

1. **Visual foundation and single product root**
   - Make the owned enterprise shell the only authenticated product frame.
   - Package the exact owned tokens, brand assets and self-hosted fonts for
     production use; remove local raw-colour approximations from this surface.
   - Keep upstream overlay/session implementation below the enterprise frame,
     not visible as product chrome.

2. **Chinese role workbenches**
   - Implement login from `ref1`, then operator, supervisor and tenant-admin
     workbenches from `ref2`–`ref4` using live/derived server facts only.
   - Derive navigation from `whoami.effective_permissions` and the page
     catalog. Do not provide a client-side role switcher in production.

3. **Business destinations**
   - Apply the owned kits to tasks, reminders, follow-up, conversations,
     knowledge, identity/provisioning, provider, usage, alert and audit pages.
   - Preserve existing controller/view-model boundaries and all server error
     semantics. Missing server operations remain visibly unavailable rather
     than becoming a mock UI.

4. **Visual and acceptance evidence**
   - Replace legacy English/upstream snapshots with reviewed screenshots of
     the owned Chinese shell at the required desktop viewports.
   - Keep the existing Electron lifecycle and a11y tests, but assert Chinese
     landmarks, role-filtered navigation, owned titlebar/header/statusbar and
     no generic Hermes client chrome.
   - Update a visual baseline only after a reviewer compares it with the
     relevant owned reference and verifies the mock server data is explicitly
     test-only and contract-shaped.

## Current migration constraint

`EnterpriseClientApp` is already the intended independent product root on the
current development line, but it is only a partial foundation. The legacy
plugin `ConsoleShell` still owns historical `/console` and visual-test paths.
The migration must consolidate them behind the owned shell; neither root may
be treated as a visual authority until that consolidation is complete.

No existing Draft PR in the old desktop chain is approved to merge solely
because its CI is green. Its business controllers and tests are candidates for
reuse, but every visual assertion must pass this document's source hierarchy.
