import { useState } from 'react'
import type { Assignment } from '../../shared/api-types'

export const statusLabels = {
  uninvited: 'Uninvited',
  invited: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
} as const
export type WorkerState = keyof typeof statusLabels

// A worker without an assignment on the shift is uninvited. Attendance takes precedence once someone checks in.
export function assignmentState(assignment: Assignment | undefined): WorkerState {
  if (!assignment) return 'uninvited'
  return assignment.attendance === 'not_started' ? assignment.participation : assignment.attendance
}

export function WorkerStatus({ assignment }: { assignment: Assignment | undefined }) {
  const state = assignmentState(assignment)
  // The badge remounts on every later change so its highlight replays. The first render stays quiet.
  const [initial] = useState(state)
  const [changed, setChanged] = useState(false)
  if (!changed && state !== initial) setChanged(true)
  return (
    <span key={state} className={'badge ' + state + (changed ? ' changed' : '')}>
      <i />
      {statusLabels[state]}
    </span>
  )
}
