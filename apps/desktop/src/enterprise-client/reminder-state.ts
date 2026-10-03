import { atom } from 'nanostores'

export interface PersonalReminder {
  reminder_id: string
  title: string
  scheduled_for: number
  state: string
  generation?: number
}

export interface ReminderCenterTask {
  group_id?: string | null
  source_type: 'receivable_followup' | 'assistant_personal'
  source_id: string
  task_source_label: string
  business_subject: string
  business_team?: string | null
  amount?: string | null
  currency?: string | null
  next_followup_at?: string | null
  status: string
  updated_at?: string | null
  task_status: string
  overdue: boolean
  owner_principal_id: string
  owner_name: string
  reminder_id?: string | null
  reminder_generation?: number | null
  allowed_actions: string[]
}

export interface FollowupScopeOptions {
  current_principal_id: string
  groups: {group_id:string;name:string}[]
  people: {principal_id:string;name:string;group_id:string|null;role:string;active:boolean}[]
}

// Populated by the shell's single reminder poller; identity-keyed, never persisted.
export const $personalReminders = atom<{ scope: string; rows: PersonalReminder[] } | null>(null)

// The server owns sorting, source association and role scope.  This atom is
// only an identity-keyed UI cache shared by the workbench summary and inbox.
export const $enterpriseReminderTasks = atom<{ scope: string; rows: ReminderCenterTask[]; scope_options?: FollowupScopeOptions } | null>(null)

export const $reminderSync = atom<{ scope: string; loading: boolean; failed: boolean; lastSuccess: number | null } | null>(null)
