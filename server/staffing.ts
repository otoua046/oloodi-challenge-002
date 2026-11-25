import type { Role, Shift, Snapshot, Worker } from '../shared/types.ts'

export const shift: Shift = {
  id: 'shift-001',
  title: 'Evening event crew',
  location: 'Harbor Hall, East Entrance',
  startsAt: '2026-11-24T22:00:00.000Z',
  endsAt: '2026-11-25T03:00:00.000Z',
  timeZone: 'America/Toronto',
  requiredWorkers: 3,
}

// Rule violations carry a stable code. The HTTP layer decides which status each code maps to.
export type StaffingErrorCode =
  | 'FORBIDDEN'
  | 'SHIFT_NOT_FOUND'
  | 'WORKER_NOT_FOUND'
  | 'INVALID_REQUEST_KEY'
  | 'REQUEST_KEY_REUSED'
  | 'INVALID_TRANSITION'

export class StaffingError extends Error {
  code: StaffingErrorCode

  constructor(code: StaffingErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function requireManager(role: Role) {
  if (role !== 'manager') {
    throw new StaffingError('FORBIDDEN', 'This action requires the Manager role.')
  }
}

// Only the selected worker can change their own assignment.
export function requireActingWorker(role: Role, actorId: string | undefined, workerId: string) {
  if (role !== 'worker' || actorId !== workerId) {
    throw new StaffingError('FORBIDDEN', 'Select this worker to change their shift.')
  }
}

export function requireShift(id: string) {
  if (id !== shift.id) throw new StaffingError('SHIFT_NOT_FOUND', 'Shift not found.')
}

export function requireRequestKey(key: string | undefined): asserts key is string {
  if (!key || key.length > 128) {
    throw new StaffingError('INVALID_REQUEST_KEY', 'Supply an Idempotency-Key of up to 128 characters.')
  }
}

// A retry returns the recorded invitation. Inviting an accepted worker is an illegal transition.
export function invitationTime(worker: Worker, now: () => string): string {
  if (worker.participation === 'invited' && worker.invitedAt) return worker.invitedAt
  if (worker.participation !== 'uninvited') {
    throw new StaffingError('INVALID_TRANSITION', 'Only an uninvited worker can receive a new invitation.')
  }
  return now()
}

export function staffingCounts(workers: Worker[]): Snapshot['counts'] {
  const filled = workers.filter(worker => worker.participation === 'accepted').length
  return {
    filled,
    remaining: shift.requiredWorkers - filled,
    checkedIn: workers.filter(worker => worker.attendance === 'checked_in').length,
    checkedOut: workers.filter(worker => worker.attendance === 'checked_out').length,
  }
}
