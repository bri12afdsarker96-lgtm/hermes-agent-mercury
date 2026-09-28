import { useEffect, useRef } from 'react'
import { registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { useDeliveryCopy } from './delivery-copy'

/** Keep newly added forms inside the existing package-update preservation barrier. */
export function useDeliveryWork(dirty: boolean) {
  const copy = useDeliveryCopy()
  const current = useRef(dirty)
  const notify = useRef<(() => void) | undefined>(undefined)
  current.current = dirty
  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => (current.current ? copy.dirty : null) })
    notify.current = activity.changed
    return () => {
      notify.current = undefined
      activity.dispose()
    }
  }, [copy.dirty])
  useEffect(() => {
    notify.current?.()
  }, [dirty])
}
