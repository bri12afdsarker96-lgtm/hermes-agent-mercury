/**
 * Reminders page — Glue layer.
 *
 * Composes controller + view-model + view. Supplies the IANA timezone
 * (derived from the browser) and the datetime-conversion helper down
 * to the view as plain values, so the view never imports any helper
 * function from the controller (it only knows the shape of the VM
 * and the form callbacks).
 *
 * Wave 1 / Step 9 of W5-B0 Controller/View Contract Freeze.
 */

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import {
  browserTimezone,
  datetimeLocalToEpochSeconds,
  makeReminderMutations,
  useRemindersData,
} from './page-reminders.controller'
import { deriveRemindersViewModel } from './page-reminders.view-model'
import { RemindersView } from './page-reminders.view'
import { useTransport } from './transport'

export function RemindersPage() {
  const who = useWhoami()
  const query = useRemindersData()
  const transport = useTransport()
  const mutations = makeReminderMutations(transport)
  const page = findPage('reminders')!
  const tz = browserTimezone()

  return (
    <QueryBody
      emptyText="no reminders"
      isEmpty={vm => !vm.isAvailable || vm.rows.length === 0}
      query={query}
    >
      {data => (
        <RemindersView
          vm={deriveRemindersViewModel({ page, whoami: who, data })}
          onCreate={body => {
            void mutations.create(body)
          }}
          onCancel={reminderId => {
            void mutations.cancel({ reminder_id: reminderId })
          }}
          onRotateIdempotencyKey={() => crypto.randomUUID()}
          timezone={tz}
          datetimeLocalToEpochSeconds={datetimeLocalToEpochSeconds}
        />
      )}
    </QueryBody>
  )
}