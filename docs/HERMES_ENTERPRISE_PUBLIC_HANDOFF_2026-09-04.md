# Hermes Enterprise public-domain handoff — 2026-09-04

This document records the public test-environment cutover for **Hermes
Enterprise / 早鸟科技**.  It is an operational handoff, not a source of
credentials: passwords, tokens, private keys, database DSNs, and recovery
codes must remain only in the approved secret store and on the protected
server.

## Current verified state

| Area | State | Evidence |
| --- | --- | --- |
| Domain | `qiqiaoban.top` is registered and DNS is active | DNSPod A records resolve publicly |
| Public endpoints | HTTPS is live | `agent`, `enterprise`, and `login` use the issued certificate |
| Certificate | Let’s Encrypt multi-SAN certificate; automatic renewal timer enabled | certificate name: `hermes-enterprise-qiqiaoban`; expiry: 2026-12-03 |
| Gateway ingress | Nginx → loopback gateway | `https://agent.qiqiaoban.top/api/status` returns 200 |
| Enterprise API ingress | Nginx → loopback Enterprise service | `https://enterprise.qiqiaoban.top/api/health` returns 200 |
| Identity issuer | Keycloak public issuer corrected | `https://login.qiqiaoban.top/realms/hermes-candidate/.well-known/openid-configuration` returns the same HTTPS issuer |
| Desktop routing | local connection configuration points to `https://agent.qiqiaoban.top`; Enterprise origin points to `https://enterprise.qiqiaoban.top` | local configuration updated on 2026-09-04 |
| Direct service exposure | gateway `18765`, Enterprise API `18080`, and Keycloak `18766` are loopback-only | verified with `ss -ltnp`; public firewall exposes only 80/443 for this stack |

Public names and ownership:

| Public hostname | Role | Private upstream |
| --- | --- | --- |
| `agent.qiqiaoban.top` | Desktop gateway, OAuth callback, WebSocket transport | `127.0.0.1:18765` |
| `enterprise.qiqiaoban.top` | Enterprise authority / data-plane API | `127.0.0.1:18080` |
| `login.qiqiaoban.top` | Keycloak OIDC issuer | `127.0.0.1:18766` |

All three A records point to `43.160.192.239`.  HTTP redirects to HTTPS.  The
Nginx configuration that was applied is checked in alongside this document at
`docs/deployment/hermes-enterprise-public-nginx.conf`; it contains no secret.

## Identity and callback alignment performed

1. Keycloak was restarted with public hostname
   `https://login.qiqiaoban.top` and `xforwarded` proxy-header support.
   Its persistent data directory was archived before the restart.
2. OIDC client `hermes-gateway` now permits the exact public callback
   `https://agent.qiqiaoban.top/auth/callback`.  The original loopback callback
   remains for the isolated local test route.
3. Gateway configuration uses the public gateway URL and public Keycloak
   issuer.  The process is loopback-bound; Nginx supplies the public TLS
   boundary and passes the expected internal Host header upstream.
4. Enterprise runtime configuration trusts the public gateway issuer and
   permits `https://agent.qiqiaoban.top` as an allowed origin.  Its upstream
   connection uses the HTTPS gateway name, not a Docker bridge address.

These changes address the prior topology failure where browser OAuth could
succeed but a client was left with an invalid enterprise session because one
side still advertised a loopback or container address.

## GitHub integration status

Integration base: `deepseek/p1-responsive-a11y-current-head-01` in
`bri12afdsarker96-lgtm/hermes-agent-mercury`.

| PR | Status at handoff | Result / next owner action |
| --- | --- | --- |
| #37 | merged | Merge commit `3e860daf25306e2bbd173eee80df5fe21a421cf1` |
| #38 | merged | Merge commit `a923b75d60927e9f3ae6c1d25cd0bfa93ce27276`; runtime-error contract rebased and full CI passed |
| #39 | merged | Merge commit `a6aa3bb9b0905edc3d5fcf25ce19d31f0a3652e1`; design foundation rebased and full CI passed |
| #40 | Draft, rebased | Head `dd98562d9b90fa5449307d55a9601ea263373bd2`; CI must be allowed to finish before review/merge |
| #41–#45 | Draft, not rebased in this handoff | Rebase each only after its predecessor merges; preserve the existing PRs and contributor history |
| #52 | Draft, not integrated | Rebase against the eventual #37–#45 integration base, resolve the Chinese Enterprise UI seam, then rerun visual E2E |
| #46–#50 | Draft, not rebased in this handoff | Start only after #52 has passed its UI integration gate |
| Server #148 | Draft, CI previously green | Merge only after Desktop #46–#50 integration, then deploy its clean commit to the candidate service |

No PR after #40 was merged in this handoff.  That is intentional: the next
owner inherits a stable, explicitly gated boundary rather than an unreviewed
bulk merge.

## Required first acceptance after handoff

1. Restart the packaged Hermes Enterprise Desktop client so it reads the new
   public connection configuration.
2. Choose **使用企业账号登录** and complete an OAuth login.  The browser must
   return through `agent.qiqiaoban.top`; no loopback URL should appear in the
   address bar or OIDC metadata.
3. Verify `/api/whoami` resolves the platform administrator; verify the
   Earlybird tenant administrator can see only Earlybird tenant data.
4. Exercise the controlled lifecycle path: enterprise administrator creates a
   supervisor, supervisor proposes an employee, enterprise administrator
   approves, then disable the employee and verify token/session revocation.
5. Capture the above as the real E2E evidence before claiming a production
   rollout.

## Still deliberately unfinished

- A clean deployment of the **merged** Server #148 commit has not occurred.
  The candidate currently uses a staged Server #148 snapshot; replace it only
  from the merged Git revision, never from the older dirty checkout.
- Desktop user-visible E2E is not yet accepted.  Unit/CI and public endpoint
  smoke checks are not a substitute for a real Desktop login and tenant-bound
  workflow.
- #52’s product-specific Chinese UI is not yet integrated with the #37–#45
  authority stack.  Preserve the independent Enterprise design; do not revert
  to the upstream Hermes Desktop UI.
- Gateway and Enterprise processes were started from the candidate runtime.
  The next owner should replace these ad-hoc launch commands with reviewed
  systemd units that load the protected environment file and restart safely.
- Windows installer signing, updater release publication, backups/restore
  rehearsal, monitoring/alert routing, and production rollout approval remain
  separate release gates.
- The externally exposed `8765/TCP` Lighthouse firewall rule belongs to an
  existing mobile Hub workload.  It was not altered by this work and must be
  reviewed independently by its service owner.

## Safe verification and rollback notes

Run these checks without printing credentials:

```powershell
curl.exe -I https://agent.qiqiaoban.top/api/status
curl.exe -I https://enterprise.qiqiaoban.top/api/health
curl.exe https://login.qiqiaoban.top/realms/hermes-candidate/.well-known/openid-configuration
```

On the candidate server, verify only loopback listeners for `18765`, `18080`,
and `18766`; Nginx is the TLS entry point.  Before every infrastructure
change, make another encrypted backup of Keycloak data and the protected
runtime environment.  To roll back a configuration issue, restore the
timestamped backup of the affected configuration, validate `nginx -t`, reload
Nginx, and restart only the relevant runtime process.  Never copy secrets into
this repository or a pull request.
