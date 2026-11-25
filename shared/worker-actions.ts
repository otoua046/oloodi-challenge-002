import type { Worker } from './types.ts'

export const workerActions = {
  accept: { label: 'Accept shift', event: 'accepted' },
  decline: { label: 'Decline invitation', event: 'declined' },
  cancel: { label: 'Cancel shift', event: 'cancelled' },
  'check-in': { label: 'Check in', event: 'checked_in' },
  'check-out': { label: 'Check out', event: 'checked_out' },
} as const

export type WorkerAction = keyof typeof workerActions

export function availableActions(worker: Worker): WorkerAction[] {
  if (worker.attendance === 'checked_out') return []
  if (worker.attendance === 'checked_in') return ['check-out']
  switch (worker.participation) {
    case 'invited': return ['accept', 'decline']
    case 'accepted': return ['check-in', 'cancel']
    case 'cancelled': return ['accept']
    default: return []
  }
}
