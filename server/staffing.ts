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

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function requireManager(role: Role) {
  if (role !== 'manager') {
    throw new ApiError(403, 'FORBIDDEN', 'This action requires the Manager role.')
  }
}

export function requireShift(id: string) {
  if (id !== shift.id) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found.')
}

// A retry returns the recorded invitation. Inviting an accepted worker is an illegal transition.
export function invitationTime(worker: Worker, now: () => string): string {
  if (worker.participation === 'invited' && worker.invitedAt) return worker.invitedAt
  if (worker.participation !== 'uninvited') {
    throw new ApiError(409, 'INVALID_TRANSITION', 'Only an uninvited worker can receive a new invitation.')
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
