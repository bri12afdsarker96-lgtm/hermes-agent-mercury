/**
 * RootRouteTakeover — R4-A TRUE_ROOT_PRODUCT_TAKEOVER
 *
 * On the very first render after fresh launch, if the user landed on the
 * upstream default root ('/' or '' or '#/new'), navigate to '#/console' so
 * Hermes-企业助手 becomes the primary default product experience.
 *
 * The navigation uses a hash ASSIGNMENT, not `history.replaceState`: a
 * replaceState rewrite is invisible to react-router (it fires neither
 * popstate nor hashchange), so the router keeps the upstream chat view on
 * screen even though `location.hash` reads '#/console'. The assignment goes
 * through the router's own event seam and the match actually lands on the
 * enterprise route.
 *
 * This runs BEFORE <App /> commits anything so the first paint already shows
 * the enterprise shell (or the Design-System Login bootstrap when no native
 * session is present). One-shot: a later deliberate navigation to the chat
 * (the Enterprise Assistant re-home entry) is NOT bounced back.
 */
import { useEffect, useState } from 'react'

function RootRouteTakeover(): null {
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (applied) {
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const h = window.location.hash

    if (h === '' || h === '#' || h === '#/' || h === '#/new' || h === '#/chat') {
      // Replace the upstream chat root with the enterprise console, through
      // the router-visible hash assignment (see header).
      window.location.hash = '#/console'
    }

    setApplied(true)
  }, [applied])

  return null
}

export { RootRouteTakeover }
