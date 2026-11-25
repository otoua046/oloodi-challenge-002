export type Role = 'manager' | 'viewer'

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
  participation: 'uninvited' | 'invited' | 'accepted'
  attendance: 'not_started' | 'checked_in' | 'checked_out'
  invitedAt: string | null
  checkedInAt: string | null
  checkedOutAt: string | null
}

export interface Snapshot {
  revision: number
  shift: Shift
  counts: { filled: number; remaining: number; checkedIn: number; checkedOut: number }
  workers: Worker[]
}

export interface InviteResponse {
  invitation: { shiftId: string; workerId: string; invitedAt: string }
  snapshot: Snapshot
}
