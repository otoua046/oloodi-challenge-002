import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import { demoManager } from '../shared/types.ts'
import type { InviteResponse, Role, Snapshot, Worker } from '../shared/types.ts'
import {
  StaffingError,
  invitationTime,
  requireActingWorker,
  requireManager,
  requireRequestKey,
  requireShift,
  shift,
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

  function requireWorker(workerId: string): Worker {
    const worker = store.findWorker(workerId)
    if (!worker) throw new StaffingError('WORKER_NOT_FOUND', 'Worker not found on this shift.')
    return worker
  }

  function readSnapshot(shiftId: string): Snapshot {
    requireShift(shiftId)
    // All three reads share the caller's transaction, even for an empty roster.
    const revision = store.revision()
    const workers = store.workers()
    const activity = store.activity()
    return { shift, workers, activity, revision, counts: staffingCounts(workers) }
  }

  function snapshot(shiftId: string) {
    return transaction('read', () => readSnapshot(shiftId))
  }

  function invite(role: Role, shiftId: string, workerId: string, key?: string) {
    requireManager(role)
    requireShift(shiftId)
    if (key !== undefined) requireRequestKey(key)
    return transaction('write', () => {
      if (key) {
        const receipt = store.invitationReceipt(key)
        if (receipt) {
          if (receipt.workerId !== workerId)
            throw new StaffingError('REQUEST_KEY_REUSED', 'This key identifies a different invitation.')
          const invitation = { shiftId, workerId, invitedAt: receipt.invitedAt }
          return { changed: false, result: { invitation, snapshot: readSnapshot(shiftId) } }
        }
      }
      const worker = requireWorker(workerId)
      const invitedAt = invitationTime(worker, now)
      const changed = worker.participation === 'uninvited'
      if (changed) {
        store.markInvited(workerId, invitedAt)
        store.recordEvent('invited', demoManager, worker, invitedAt)
      }
      if (key) store.saveInvitationReceipt(key, workerId, invitedAt)
      const result: InviteResponse = { invitation: { shiftId, workerId, invitedAt }, snapshot: readSnapshot(shiftId) }
      return { changed, result }
    })
  }

  function workerAction({ role, actorId, shiftId, workerId, action, key }: WorkerCommand) {
    requireActingWorker(role, actorId, workerId)
    requireShift(shiftId)
    requireRequestKey(key)
    return transaction('write', () => {
      const worker = requireWorker(workerId)
      const kind = workerActions[action].event
      const prior = store.eventKindForKey(workerId, key)
      if (prior) {
        if (prior !== kind)
          throw new StaffingError('REQUEST_KEY_REUSED', 'This request key already identifies another action.')
        return { changed: false, snapshot: readSnapshot(shiftId) }
      }
      if (!availableActions(worker).includes(action)) {
        throw new StaffingError('INVALID_TRANSITION', 'This action is unavailable for the current shift status.')
      }
      const at = now()
      if (kind === 'checked_in') store.checkIn(workerId, at)
      else if (kind === 'checked_out') store.checkOut(workerId, at)
      else store.setParticipation(workerId, kind)
      store.recordEvent(kind, worker.name, worker, at, key)
      return { changed: true, snapshot: readSnapshot(shiftId) }
    })
  }

  function reset(role: Role) {
    requireManager(role)
    return transaction('write', () => {
      store.restoreSeedRoster()
      store.recordEvent('reset', demoManager, null, now())
      return readSnapshot(shift.id)
    })
  }

  return { snapshot, invite, workerAction, reset, close: store.close }
}
