export type Role = 'manager' | 'viewer' | 'worker'

// An event that needs people: when, where, and how many.
export interface Shift {
  id: string
  title: string
  location: string
  startsAt: string
  endsAt: string
  timeZone: string
  requiredWorkers: number
}

// A person who can be staffed on any shift.
export interface Worker {
  id: string
  name: string
}

// One worker's place on one shift. An invitation creates it, so a worker without one is uninvited.
export interface Assignment {
  shiftId: string
  workerId: string
  participation: 'invited' | 'accepted' | 'declined' | 'cancelled'
  attendance: 'not_started' | 'checked_in' | 'checked_out'
  invitedAt: string
  checkedInAt: string | null
  checkedOutAt: string | null
}

export interface ActivityEvent {
  id: number
  kind: 'invited' | 'accepted' | 'declined' | 'cancelled' | 'checked_in' | 'checked_out' | 'reset'
  actor: string
  // Null for demo resets, which apply to every shift.
  shiftId: string | null
  workerId: string | null
  workerName: string | null
  occurredAt: string
}

export interface StaffingCounts {
  filled: number
  remaining: number
  checkedIn: number
  checkedOut: number
}

export const demoManager = 'Maya Patel'
// The shift the dashboard shows. The API serves every shift in the database.
export const demoShiftId = 'shift-001'

// Everything a client needs to show one shift.
export interface Snapshot {
  activity: ActivityEvent[]
  revision: number
  shift: Shift
  counts: StaffingCounts
  // Everyone who can be staffed, whether or not they have an assignment on this shift.
  workers: Worker[]
  assignments: Assignment[]
}

export interface ShiftSummary extends Shift {
  counts: StaffingCounts
}

export interface InviteResponse {
  invitation: { shiftId: string; workerId: string; invitedAt: string }
  snapshot: Snapshot
}
