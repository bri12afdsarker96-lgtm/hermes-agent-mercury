/**
 * ENTERPRISE ELIGIBILITY — the host-level, NON-SECRET signal that decides
 * whether the bundled Enterprise Console plugin is available, plus a tiny
 * registry so the generic plugin loader stays plugin-agnostic.
 *
 * `$enterpriseAvailable` is a product-ownership flag, not a session signal
 * anymore (REM-02): the console is the PRIMARY desktop product frame — its
 * route must exist on a fresh cold start so the RootRouteTakeover lands on
 * the Design-System Login bootstrap before any session exists. It carries NO
 * bearer and NO secret — only a boolean — and is never persisted. The user's
 * explicit Plugins toggle still wins over it (the loader composes the atom
 * with the persisted decision).
 *
 * The plugin lifecycle itself is untouched: `bindEligibility` (plugins-store)
 * drives the EXISTING activate/deactivate handles from this atom composed with
 * the user's explicit localStorage decision. No second plugin manager.
 */

import { atom, type ReadableAtom } from 'nanostores'

/** Non-secret: whether an authenticated enterprise session is available. */
export const $enterpriseAvailable = atom<boolean>(false)

/** id -> eligibility atom. Lets the loader bind eligibility without hard-coding
 *  which plugin is the enterprise one (the shell registers that at boot). */
const eligibilityAtoms = new Map<string, ReadableAtom<boolean>>()

/** Register a plugin id as capability/availability-gated (call at shell boot,
 *  BEFORE plugin discovery). */
export function registerEligibility(id: string, available: ReadableAtom<boolean>): void {
  eligibilityAtoms.set(id, available)
}

/** The eligibility atom for a plugin id, if it was registered. */
export function eligibilityAtomFor(id: string): ReadableAtom<boolean> | undefined {
  return eligibilityAtoms.get(id)
}

/** Test-only: forget all eligibility registrations. */
export function __resetEligibility(): void {
  eligibilityAtoms.clear()
}
