/**
 * RootRouteTakeover — R4-A TRUE_ROOT_PRODUCT_TAKEOVER
 *
 * On the very first render after fresh launch, if the user landed on the
 * upstream default root ('/' or '' or '#/new'), rewrite the hash to '#/console'
 * so Hermes-企业助手 becomes the primary default product experience.
 *
 * This runs BEFORE <App /> commits anything so the first paint already shows
 * the enterprise shell (or the honest disconnected bootstrap state if no
 * native session is present).
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
      // Replace upstream chat root with enterprise console.
      window.history.replaceState(null, '', '#/console')
    }
    setApplied(true)
  }, [applied])

  return null
}

export { RootRouteTakeover }
