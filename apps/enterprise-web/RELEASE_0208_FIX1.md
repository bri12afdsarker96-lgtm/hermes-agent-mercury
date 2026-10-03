# Web 0.20.8-fix1 — browser adapter parity

Published 2026-10-02. This is a web-only static hotfix, not a desktop release.

## Changes

- AI assist waits up to 75 seconds, matching installed desktop 0.20.7. Ordinary JSON writes retain 20 seconds and file uploads 60 seconds. Writes are not automatically retried.
- Explicit account logout calls the existing same-origin browser-logout endpoint. Server confirmation precedes visible session cleanup; failed requests remain retryable. Runtime teardown still only releases a local handle, so StrictMode cleanup, refresh and reconnect do not sign out the cookie. Late autoConnect results cannot undo logout.
- Added a System notifications control beside Account security. Permission is requested only on an explicit click. The existing reminder bridge now creates browser notifications when authorized. Denied/unsupported states explain recovery without disabling in-page reminders or the bundled MP3. Browser/OS delivery and autoplay restrictions still apply; closed-page delivery is not promised.
- The shared root only gains optional web-provided account actions and a pre-logout callback. Desktop callers retain their previous behavior; no desktop package was built or published.
- Web production entry is now strictly typechecked instead of using --noCheck. DOM/ES2023 libraries match shared renderer usage; Electron/unit-test compilation is separate from the web production entry.

## Verification

- Web bridge/notification unit tests: 12 passed, including desktop timeout parity, delayed reply, POST non-retry, failed and malformed logout, runtime teardown, stale connection response and notification fallback.
- Shared app/runtime regression: 33 passed.
- Built-web browser tests: 7 passed. API fixtures isolate all business data; Chromium's real HttpOnly cookie jar verifies logout and refresh. Delayed response uses the browser test clock; notification permission/constructor tests are simulated to avoid changing user permissions or posting real OS notifications.
- Production anonymous logout: 401 with HttpOnly Secure SameSite=Strict Max-Age=0 cookie. No real user session was logged out for testing.
- 71 static file hashes matched before and after publication. HTTPS root and main JS matched the built artifact. CSS and reminder MP3 are unchanged. Live OS toast delivery on the user's computer still requires user permission and acceptance.

## Deployment / recovery

Current index: `assets/index-swgJ6JCD.js`; CSS: `assets/index-BFr28uGW.css`.

Static files were added to `/opt/hermes/releases/enterprise-web-v0.20.8-20261002/enterprise_web`, then index.html was atomically replaced. All old hashed assets remain available to existing tabs. The backend was not restarted (PID 2102000 before and after), and no backend code, database or nginx settings changed.

Staged release and previous index: `/opt/hermes/releases/enterprise-web-v0.20.8-fix1-20261002`. To roll back this hotfix only, install its `previous-index.html` to a temporary file in the live web directory, then atomically rename to index.html. Do not delete old assets or replace the backend release. Hash manifest and one-shot publish script are under `releases/` beside this document.

Desktop feed SHA256 remains `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`; desktop stays at 0.20.7. Refresh the web page to load the hotfix. No full visual/function parity claim is made by this targeted release.
