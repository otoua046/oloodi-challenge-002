export type Role = 'manager' | 'viewer' | 'worker'

export interface Shift {
  id: string
  title: string
  location: string
  startsAt: string
  endsAt: string
  timeZone: string
  requiredWorkers: number
}

export interface Worker {
  id: string
  name: string
  participation: 'uninvited' | 'invited' | 'accepted' | 'declined' | 'cancelled'
  attendance: 'not_started' | 'checked_in' | 'checked_out'
  invitedAt: string | null
  checkedInAt: string | null
  checkedOutAt: string | null
}

export interface ActivityEvent {
  id: number
  kind: 'invited' | 'accepted' | 'declined' | 'cancelled' | 'checked_in' | 'checked_out' | 'reset'
  actor: string
  workerId: string | null
  workerName: string | null
  occurredAt: string
}

export const demoManager = 'Maya Patel'

export interface Snapshot {
  activity: ActivityEvent[]
  revision: number
  shift: Shift
  counts: { filled: number; remaining: number; checkedIn: number; checkedOut: number }
  workers: Worker[]
}

export interface InviteResponse {
  invitation: { shiftId: string; workerId: string; invitedAt: string }
  snapshot: Snapshot
}
