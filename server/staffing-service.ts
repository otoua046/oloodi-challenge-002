import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import { demoManager, demoShiftId } from '../shared/types.ts'
import type { InviteResponse, Role, Shift, ShiftSummary, Snapshot } from '../shared/types.ts'
import {
  StaffingError,
  invitationTime,
  requireActingWorker,
  requireManager,
  requireRequestKey,
  requireShift,
  requireWorker,
  staffingCounts,
} from './staffing.ts'
import { openShiftDatabase } from './storage/sqlite.ts'

interface WorkerCommand {
  role: Role
  actorId?: string
  shiftId: string
  workerId: string
  action: WorkerAction
  key?: string
}

export function openStaffing(databasePath: string, now: () => string = () => new Date().toISOString()) {
  const store = openShiftDatabase(databasePath)
  const { transaction } = store

  function readSnapshot(shift: Shift): Snapshot {
    // All reads share the caller's transaction, so the snapshot is consistent.
    const revision = store.revision()
    const workers = store.workers()
    const assignments = store.assignments(shift.id)
    const activity = store.activity(shift.id)
    return { shift, workers, assignments, activity, revision, counts: staffingCounts(shift, assignments) }
  }

  function snapshot(shiftId: string) {
    return transaction('read', () => readSnapshot(requireShift(store.findShift(shiftId))))
  }

  function shifts(): ShiftSummary[] {
    return transaction('read', () =>
      store.shifts().map(shift => ({ ...shift, counts: staffingCounts(shift, store.assignments(shift.id)) })),
    )
  }

  function invite(role: Role, shiftId: string, workerId: string, key?: string) {
    requireManager(role)
    return transaction('write', () => {
      const shift = requireShift(store.findShift(shiftId))
      if (key !== undefined) requireRequestKey(key)
      if (key) {
        const receipt = store.invitationReceipt(key)
        if (receipt) {
          if (receipt.shiftId !== shiftId || receipt.workerId !== workerId) {
            throw new StaffingError('REQUEST_KEY_REUSED', 'This key identifies a different invitation.')
          }
          const invitation = { shiftId, workerId, invitedAt: receipt.invitedAt }
          return { changed: false, result: { invitation, snapshot: readSnapshot(shift) } }
        }
      }
      const worker = requireWorker(store.findWorker(workerId))
      const assignment = store.findAssignment(shiftId, workerId)
      const invitedAt = invitationTime(assignment, now)
      const changed = !assignment
      if (changed) {
        store.addAssignment(shiftId, workerId, invitedAt)
        store.recordEvent('invited', demoManager, shiftId, worker, invitedAt)
      }
      if (key) store.saveInvitationReceipt(key, shiftId, workerId, invitedAt)
      const result: InviteResponse = { invitation: { shiftId, workerId, invitedAt }, snapshot: readSnapshot(shift) }
      return { changed, result }
    })
  }

  function workerAction({ role, actorId, shiftId, workerId, action, key }: WorkerCommand) {
    requireActingWorker(role, actorId, workerId)
    return transaction('write', () => {
      const shift = requireShift(store.findShift(shiftId))
      requireRequestKey(key)
      const worker = requireWorker(store.findWorker(workerId))
      const kind = workerActions[action].event
      const prior = store.eventKindForKey(shiftId, workerId, key)
      if (prior) {
        if (prior !== kind) {
          throw new StaffingError('REQUEST_KEY_REUSED', 'This request key already identifies another action.')
        }
        return { changed: false, snapshot: readSnapshot(shift) }
      }
      if (!availableActions(store.findAssignment(shiftId, workerId)).includes(action)) {
        throw new StaffingError('INVALID_TRANSITION', 'This action is unavailable for the current shift status.')
      }
      const at = now()
      if (kind === 'checked_in') store.checkIn(shiftId, workerId, at)
      else if (kind === 'checked_out') store.checkOut(shiftId, workerId, at)
      else store.setParticipation(shiftId, workerId, kind)
      store.recordEvent(kind, worker.name, shiftId, worker, at, key)
      return { changed: true, snapshot: readSnapshot(shift) }
    })
  }

  // Restores the seeded assignments on every shift and returns the demo shift's snapshot.
  function reset(role: Role) {
    requireManager(role)
    return transaction('write', () => {
      store.restoreSeedAssignments()
      store.recordEvent('reset', demoManager, null, null, now())
      return readSnapshot(requireShift(store.findShift(demoShiftId)))
    })
  }

  return { snapshot, shifts, invite, workerAction, reset, close: store.close }
}
