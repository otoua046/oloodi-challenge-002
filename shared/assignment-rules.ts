import type { Assignment } from './api-types.ts'

export const workerActions = {
  accept: { label: 'Accept shift', event: 'accepted' },
  decline: { label: 'Decline invitation', event: 'declined' },
  cancel: { label: 'Cancel shift', event: 'cancelled' },
  'check-in': { label: 'Check in', event: 'checked_in' },
  'check-out': { label: 'Check out', event: 'checked_out' },
} as const

export type WorkerAction = keyof typeof workerActions

// What a worker can do next on one shift. Without an assignment there is nothing to respond to.
export function availableActions(assignment: Assignment | undefined): WorkerAction[] {
  if (!assignment || assignment.attendance === 'checked_out') return []
  if (assignment.attendance === 'checked_in') return ['check-out']
  switch (assignment.participation) {
    case 'invited':
      return ['accept', 'decline']
    case 'accepted':
      return ['check-in', 'cancel']
    case 'cancelled':
      return ['accept']
    default:
      return []
  }
}
