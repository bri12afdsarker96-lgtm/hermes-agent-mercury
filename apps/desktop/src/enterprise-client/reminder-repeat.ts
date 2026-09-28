/** Presentation-only clock. Never writes a reminder or changes its business state. */
export const REMINDER_REPEAT_MS = 30 * 60 * 1000
export interface ReminderCue {
  id: string
  occurrence: string
  status: string
  title: string
  body: string
}
interface Announcement { occurrence: string; status: string; firstAt: number; repeated: boolean }
export class ReminderRepeatTracker {
  private announced = new Map<string, Announcement>()

  /** Call only with a fresh, complete, successful server snapshot for this source. */
  reconcile(rows: ReminderCue[], now: number): (ReminderCue & { repeated: boolean })[] {
    const active = new Set(rows.map(row => row.id))
    for (const id of this.announced.keys()) {
      if (!active.has(id)) {this.announced.delete(id)}
    }
    const cues: (ReminderCue & { repeated: boolean })[] = []
    for (const row of rows) {
      const previous = this.announced.get(row.id)
      if (!previous || previous.occurrence !== row.occurrence) {
        this.announced.set(row.id, { occurrence: row.occurrence, status: row.status, firstAt: now, repeated: false })
        cues.push({ ...row, repeated: false })
      } else if (previous.status !== row.status) {
        // Any authoritative state update cancels the old cycle's follow-up cue.
        previous.status = row.status
        previous.repeated = true
      } else if (!previous.repeated && now - previous.firstAt >= REMINDER_REPEAT_MS) {
        previous.repeated = true
        cues.push({ ...row, repeated: true })
      }
    }
    return cues
  }
}
