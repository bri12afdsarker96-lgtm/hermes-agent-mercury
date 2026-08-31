// enterprise-origin-candidate.ts
//
// B16-OL · Trusted main-owned enterprise-origin resolution seam.
//
// Why this seam exists:
//
//   The Agent gateway and the Hermes_AI Enterprise `/api/*` plane are DISTINCT
//   origins (proven by the OL-council topology decision). The renderer must
//   never own the enterprise origin, so main is the only authority. Main
//   currently reads HERMES_DESKTOP_ENTERPRISE_ORIGIN from process.env only,
//   but a GUI app launched from Windows Explorer inherits a stale env
//   snapshot: a value set via `setx` AFTER login is invisible to process.env
//   even though a fresh shell — and the Hermes CLI — sees it immediately.
//
//   This module closes the gap by giving main one deterministic, pure
//   function for picking the candidate value:
//
//     1. processEnv (this process's authoritative explicit config) wins.
//        An explicit-but-invalid value MUST fail closed; we never silently
//        substitute another origin, because that would let a misconfigured
//        launcher redirect traffic to an attacker-controlled host under the
//        cover of "we read the registry".
//     2. When processEnv is absent/blank, fall back to windowsUserEnv — the
//        live HKCU\Environment value, read via the existing
//        readWindowsUserEnvVar seam. Off-Windows that helper is a no-op.
//
//   The function is pure: it takes the two candidate values and returns the
//   string that should be passed to normalizeEnterpriseApiOriginOrNull. It
//   performs no I/O, no IPC, no env mutation, no logging. The caller in
//   main.ts is responsible for any logging.
//
//   Pure-function extraction is also what makes this seam testable from a
//   Linux runner — IPC-handler-level injection of process.env + a reg
//   stub simultaneously is brittle and would either duplicate the resolver
//   logic in tests (forbidden by P3.4) or require Windows-only CI.

export interface EnterpriseOriginCandidateSource {
  /**
   * The explicit, process-scoped configuration. When this is a non-blank
   * string, it is authoritative regardless of the Windows HKCU fallback.
   * `undefined` / `null` / `''` / whitespace-only all mean "not provided
   * by the explicit channel".
   */
  processEnv?: unknown

  /**
   * LAZY accessor for the live Windows HKCU\Environment value, as
   * resolved by readWindowsUserEnvVar. The helper invokes this callback
   * at most once, and only when `processEnv` is absent or blank. Pass
   * `undefined` to model "no Windows fallback available at all"; pass a
   * zero-arg function whose return value models the live registry read.
   *
   * Invariant (proved by tests): the callback MUST NOT be invoked when
   * `processEnv` resolves to a non-blank string. This matters because
   * the Windows helper spawns `reg` and the GUI process is allowed to
   * skip that work entirely when the explicit env is already present.
   */
  windowsUserEnvReader?: () => string | null
}

/**
 * Pick the trusted main-owned candidate string for HERMES_DESKTOP_ENTERPRISE_ORIGIN.
 *
 * Returns the raw candidate string to feed into
 * `normalizeEnterpriseApiOriginOrNull`. This function does NOT validate the
 * URL — the existing enterprise-transport normalizer is the single source of
 * truth for the non-loopback HTTPS policy and the no-credentials rule. Do
 * not re-implement that policy here.
 *
 * Fail-closed guarantees (callers MUST NOT bypass):
 *
 *   - When `processEnv` is a non-blank string, it is returned verbatim
 *     (validation downstream decides null vs URL). The
 *     `windowsUserEnvReader` callback is NOT invoked, even when the
 *     explicit value would later be rejected by the normalizer. This
 *     is the lazy contract: zero `reg` spawns when explicit env wins.
 *   - When `processEnv` is absent/blank, `windowsUserEnvReader` is
 *     invoked at most once; its return value is returned (which may
 *     itself be null off-Windows or when the registry value is missing).
 *   - When neither source yields a non-blank string, returns `null`.
 *
 * Returns `null` on `null`/`undefined`/non-string inputs — never throws.
 */
export function resolveEnterpriseOriginCandidate(
  source: EnterpriseOriginCandidateSource
): string | null {
  const explicit = normalizeCandidateString(source?.processEnv)

  if (explicit !== null) {
    // Explicit, non-blank process env is authoritative. Validation lives
    // downstream in normalizeEnterpriseApiOriginOrNull; we must NOT mask a
    // would-be validation failure by silently switching to the registry.
    // Crucially, we must NOT call the registry reader here either — the
    // whole point of the lazy seam is to skip the `reg` spawn whenever
    // the explicit channel already produced a candidate.
    return explicit
  }

  // processEnv was absent/blank — only now consult the registry reader.
  // Guard with optional chaining so callers that pass `undefined`
  // (no Windows fallback available) cleanly resolve to `null`.
  const fallback = normalizeCandidateString(source?.windowsUserEnvReader?.())

  return fallback
}

function normalizeCandidateString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }


  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
