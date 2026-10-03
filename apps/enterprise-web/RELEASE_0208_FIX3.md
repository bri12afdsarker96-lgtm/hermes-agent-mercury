# Web 0.20.8-fix3 — audited controls and task mappings

Published 2026-10-03. Web-only static release; desktop 0.20.7 and updater feed unchanged.

## Delivered

- Original UI-01–UI-13 audit implementation completed: visible empty search, native form control boundaries/focus, clear creation/query sections, group edit labels, knowledge editing/selection wording, model/member selects, and field-level validation feedback without changing validation rules.
- Money shortcuts retain currency and matching-task semantics. A pending request cannot present the previous selection as ready; changing session scope hides previous-scope report data immediately.
- Overview overdue count opens overdue tasks; pending count opens the unified inbox and resets a previous inbox filter. Preview entries open only their selected task. Existing selected-task dialogs remain shared across reminder/receivable/overdue paths.
- Web presentation is opt-in at composition time. No native build, installer, update publication, backend edit, database migration, financial test write, permission expansion or reminder-schedule change.

Agency UI Designer/UX Architect guided the control and mapping consistency work. Code Reviewer/Identity & Access Engineer and a separate visual audit produced two follow-up reports; their new business-policy decisions and large layout proposals are not silently included here.

## Verification and limitations

- Strict web TypeScript and production build passed.
- Web units: 15 passed. Shared renderer targeted regression: 61 passed. Built-web Playwright: 16 passed.
- Isolated fixtures exercised 1366×768, 1920×1080, 960×540 controls, keyboard focus, password/amount errors, delete confirmation cancellation, task mapping and session races. No production financial writes.
- 960 CSS pixels is a layout proxy, not genuine browser 200% zoom. No production all-role acceptance, full screen-reader audit or full-system security certification is claimed. Prior unrelated voice-suite failures remain documented in RELEASE_0208.md.
- Server normal-certificate HTTPS index/JS/CSS hashes verified. Service remained active, PID 2378170 unchanged; backend report module hash and desktop feed hash unchanged.

## Deployment evidence

- Live static path: `/opt/hermes/releases/enterprise-web-v0.20.8-fix2-20261002/enterprise_web` (backend release path intentionally unchanged).
- New staging/evidence/rollback directory: `/opt/hermes/releases/enterprise-web-v0.20.8-fix3-20261003`.
- Archive SHA256: `17872c4f11edd579c640c5a085a6e72be84a51827cb6678f7e7ea146409d931d`.
- Index SHA256: `f37754bf7a8c8ec37242bad53987e93db2cd97bbbe20330d3caa878cf547dc36`.
- JS: `index-aoOur54U.js`; CSS: `index-QO6RTagY.css`.
- Unchanged backend reporting module SHA256: `a63a1f434f4e82c7f40b94f36dc2c89996c21ec41a6c20774d6839e9d71d9be1`.
- Unchanged desktop feed SHA256: `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`.
- Reproducible guarded script: `releases/publish-0.20.8-fix3.py`; server evidence: `release-manifest.json`, `deployment-result.json`, `previous-index.html`.
- Assets were added without overwriting conflicting hashed assets; previous assets retained. Index replaced atomically. Verification failure restores previous index automatically.

Rollback only the static index: copy the stage's `previous-index.html` to a temporary file inside the verified live static directory, set 0644, then atomically replace live `index.html`. Do not change the service override, financial data, desktop feed or dependency/runtime directories.

## Separate second-pass audits

- `BUSINESS_PERMISSION_AUDIT_20261003.md`: 7 evidenced code issues and 2 permission/business-policy decisions. Highest priority is receivable visibility after employee deletion/deactivation and reminder truncation.
- `VISUAL_LAYOUT_AUDIT_20261003.md`: 6 confirmed layout issues and 4 optimization/risk items. Highest priority is reminder inbox placement, nested scrolling and narrow-width behavior.

Refresh the web page to load fix3. New follow-up findings require separately scoped implementation and corresponding role/state/amount acceptance; this release does not claim they are resolved.
