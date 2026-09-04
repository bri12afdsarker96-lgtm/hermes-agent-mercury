# ENTERPRISE_CONSOLE_ACTIVATION_CONTRACT

Two layers of "is the console available to this user":

## L2 — in-page product gating (DONE, in this plugin)

Once the console page is open, what it shows is already gated by the **server's
authenticated session**, not by anything the client decides:

- `ConsoleShell` renders a connect gate until `/api/whoami` succeeds (`console.tsx`,
  `session.ts`).
- Nav rows and page content are gated by `PermissionGate` / `CapabilityGate` reading
  `effective_permissions` / `product_capabilities` from whoami (`gate.tsx`,
  `capabilities.ts`) — UI display control only; the server still enforces.
- Capabilities that are DEV are shown as DEV (Capability Truth).

This is the correct Phase-1 in-page contract and needs no core change.

## L1 — product entry / auto-appear = ACTIVATION_SEAM_GAP (returned to TOTAL-CONTROL)

Goal (frozen ask): a legitimate enterprise user who has an authenticated Hermes session
should see the Console appear as a **product feature**, its visibility decided by
`effective_permissions` / `product_capabilities` / server connection — **not** by manually
enabling a plugin in Developer ▸ Plugins, and **not** by `defaultEnabled:true` for everyone.

Mercury's current plugin system cannot carry this (activation-seam census):

- Plugin enablement is decided only by a localStorage decision vs the plugin's **static**
  `defaultEnabled` (`src/contrib/plugins-store.ts` `pluginActive`, `src/contrib/plugins.ts`
  discovery). There is **no capability/flag-driven enable path**, no app-level whoami/
  capability store, and no precedent for conditional auto-enable.
- **Chicken-and-egg:** whoami / capabilities only exist **after** the operator connects
  *inside* the console page, so the plugin's own whoami cannot gate whether the plugin is
  enabled (the page must already be enabled to connect).

Closing L1 therefore requires (all Integrator-owned core/shared, and a cross-repo decision):

1. an **app-level "authenticated enterprise session + capabilities" signal** that exists
   *before* the plugin page renders (new store + `host.state` exposure via `src/sdk/index.ts`);
2. a **capability-aware enable hook** in `plugins-store.ts` / `plugins.ts` (auto-enable when a
   predicate over that signal holds, keeping manual override + inventory);
3. resolving the first-auth path — it must derive from the already-authenticated brain
   gateway or a pre-page auth, **not** the console page's own form (a Hermes_AI
   webserver/transport concern, cross-repo).

Per TOTAL-CONTROL ("no second plugin manager; return ACTIVATION_SEAM_GAP"), this is returned
as an explicit GAP rather than built. **Interim (construction only):** `defaultEnabled:false`
+ Settings ▸ Plugins opt-in is retained; it is explicitly **not** the final product entry.

**Decision requested:** (a) accept L2 as the Phase-1 in-page activation contract; (b) authorize
or defer the L1 app-level activation seam as a separate Integrator + server workstream, with the
`product_capabilities` key for the console to be defined server-side.
