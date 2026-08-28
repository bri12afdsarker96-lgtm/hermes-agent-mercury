# B13 · Server Write-Surface Census (Desktop control actions)

> Read-only census of the Hermes web server at live default
> `claude/hermes-desktop-multi-ai-phone-aiw5mr` @ `3bc2870f36cff698c9bd5eb21dc7e36242a33040`.
> Only **real webserver `/api/*` routes** count as Desktop-consumable API — domain
> Python methods with no HTTP route are `HTTP_API_MISSING`, not consumable.

Every page is split into READ_STATUS and CONTROL_STATUS so "the page has data"
is never mistaken for "the workflow is complete".

| PAGE | READ_STATUS | CONTROL_STATUS | WRITE ROUTES (method · perm) | AUTHORITY / IDEMPOTENCY / AUDIT | NOTES |
|---|---|---|---|---|---|
| **Task** | READY | READY | POST biz-task-create (`biztask.write`), -retry (`biztask.write`), -close (`biztask.write`), -escalate (`biztask.escalate`), -claim (`biztask.claim`), -resolve (`biztask.resolve`) | server state machine (`biz_tasks.py`); create takes `idempotency_key`; tenant server-enforced | conflicts → 409 `{ok:false,code,detail}` |
| **Reminder** | READY | READY | POST reminder-create (`reminder.write`), reminder-cancel (`reminder.write`) | server; create `idempotency_key`; tz validated server-side | invalid tz → 400 |
| **Human Handoff** | READY | READY (queue ops) | POST handoff-claim (`inbox.claim`), -reply (`inbox.reply`), -requeue (`inbox.requeue`), -reassign (`inbox.requeue`), -preempt (`handoff.preempt`), -reset (`handoff.reset`) | server; agent_id server-injected; audited (preempt/reset) | 501 if inbox unassembled |
| **Enterprise Knowledge** | READY (gaps) / PARTIAL (sources) | PARTIAL | POST kb-gap-author (`kb.author`), kb-gap-reject (`kb.reject`), knowledge-commit (`kb.commit`), knowledge-delete (`kb.delete`), -upload/-rechunk/-edit-chunks/-rollback | server; commit idempotent; DEV capability | **review** = gap author/reject (READY); **publish** = commit needs an upload flow; **withdraw** = delete needs a committed source list — later slice |
| **Provider** | READY | READY (super_admin) | POST select-provider (`provider.set`), set-provider-key (`provider.set_key`, strict-only) | server; key write-only (never returned) | super_admin role-gated |
| **Identity** | READY (principals) | PARTIAL | POST principals (create, `principal.crud`), principals-delete, delegations, delegations-delete | server; create returns one-time token | **ChannelBinding** CRUD = HTTP_API_MISSING |
| **Usage / Budget** | PARTIAL | PARTIAL | POST tenant-profile (`tenant.profile.write`, optimistic `expected_version`) | server; versioned | realtime usage read = MISSING |
| **Conversations** | PARTIAL | MISSING | — (delivery-outbox is read-only; §26 no retry API) | — | inbound/held/recovery = MISSING |
| **WeCom** | MISSING | MISSING | — | — | connector-config authority MISSING |
| **Business Follow-up** | MISSING | MISSING | — (`enterprise/followup.py` domain exists) | — | HTTP_API_MISSING — awaiting server companion |
| **Audit Replay** | MISSING | MISSING | — (audit is append-only write) | — | no read/replay route |

## PHASE1-SERVER-CONSOLE-API-GAPS (ledger — server-owned, not faked by Desktop)

1. **WeCom management** — integration status / callback health / secret state: no route.
2. **Business Follow-up** — domain exists (`enterprise/followup.py`); HTTP_API_MISSING.
3. **Audit Replay** — append-only write; no read/replay route.
4. **ChannelBinding CRUD** — `PgChannelBindingStore` domain only; no route.
5. **Realtime usage metering** — only counters + budget config; no usage read endpoint.
6. **Conversations recovery/held/inbound** — outbound outbox read-only; no inbound/held/recovery route.
7. **Knowledge publish/withdraw full flow** — gap author/reject + commit/delete routes exist, but the
   upload→preview→commit publish flow and committed-source withdraw need the upload surface (later slice).

## STEP 2 — implemented (real writes only)

All via the existing `ConfirmDialog` / `Dialog` + `Input`/`Textarea` + React Query
invalidation (`actions.tsx`: `ConfirmAction`, `FormAction`). Success →
`invalidateQueries` (authoritative refetch); no local optimistic success, no local state
machine, tenant/permission decided by the server; errors (401/403/409/unavailable) fail
closed in the dialog.

- **Task:** create, retry, escalate, close.
- **Reminder:** create, cancel.
- **Human Handoff:** claim → reply → requeue (the minimal operator flow).
- **Knowledge review:** gap author, gap reject.
- **Provider:** select-provider, set-provider-key (api key is a password field — never
  displayed/logged).

## Deferred writes (Phase-1 justification — real routes, not the minimal Phase-1 loop)

- **biz-task claim / resolve** — operator-agent claim/resolve (needs agent-identity +
  verifier context); the admin loop is covered by create/retry/close/escalate.
- **handoff reassign / preempt / reset** — supervisor-advanced, role-gated; the minimal
  operator flow is claim/reply/requeue.
- **Knowledge publish (commit) / withdraw (delete)** — need the upload→preview→commit
  surface + a committed-source list; the minimal Phase-1 review flow is author/reject.
- **Identity principal create/delete + delegations** — identity-admin writes; create
  returns a one-time token needing a secure reveal UX. Read is shown; ChannelBinding is a
  server gap.
- **Budget edit (tenant-profile write)** — small follow-up; budget is shown read-only now.

These are recorded as CONTROL_STATUS = partial where the page has some control, and are
follow-up slices — not fabricated, not blocking.
