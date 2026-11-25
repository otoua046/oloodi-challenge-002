import type { Assignment, Role, Shift, StaffingCounts, Worker } from '../shared/types.ts'

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

export function requireShift(shift: Shift | undefined): Shift {
  if (!shift) throw new StaffingError('SHIFT_NOT_FOUND', 'Shift not found.')
  return shift
}

export function requireWorker(worker: Worker | undefined): Worker {
  if (!worker) throw new StaffingError('WORKER_NOT_FOUND', 'Worker not found.')
  return worker
}

export function requireRequestKey(key: string | undefined): asserts key is string {
  if (!key || key.length > 128) {
    throw new StaffingError('INVALID_REQUEST_KEY', 'Supply an Idempotency-Key of up to 128 characters.')
  }
}

// An invitation creates the assignment. A retry returns the recorded invitation time.
// Any other existing assignment, such as an accepted one, cannot be invited again.
export function invitationTime(assignment: Assignment | undefined, now: () => string): string {
  if (assignment?.participation === 'invited') return assignment.invitedAt
  if (assignment) {
    throw new StaffingError('INVALID_TRANSITION', 'Only an uninvited worker can receive a new invitation.')
  }
  return now()
}

// Accepted assignments fill places throughout attendance.
export function staffingCounts(shift: Shift, assignments: Assignment[]): StaffingCounts {
  const filled = assignments.filter(assignment => assignment.participation === 'accepted').length
  return {
    filled,
    remaining: shift.requiredWorkers - filled,
    checkedIn: assignments.filter(assignment => assignment.attendance === 'checked_in').length,
    checkedOut: assignments.filter(assignment => assignment.attendance === 'checked_out').length,
  }
}
