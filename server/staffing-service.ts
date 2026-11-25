import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import { demoManager } from '../shared/types.ts'
import type { ActivityEvent, InviteResponse, Role, Snapshot, Worker } from '../shared/types.ts'
import {
  StaffingError, invitationTime, requireActingWorker, requireManager, requireRequestKey, requireShift, shift, staffingCounts,
} from './staffing.ts'
import { openShiftDatabase, seedRoster } from './storage/sqlite.ts'

interface WorkerCommand {
  role: Role
  actorId?: string
  shiftId: string
  workerId: string
  action: WorkerAction
  key?: string
}

export function openStaffing(databasePath: string, now: () => string = () => new Date().toISOString()) {
  const { db, transaction } = openShiftDatabase(databasePath)
  const addEvent = db.prepare('INSERT INTO activity(kind, actor, workerId, workerName, occurredAt, requestKey) VALUES (?, ?, ?, ?, ?, ?)')
  const bumpRevision = db.prepare('UPDATE state SET revision = revision + 1')
  const findWorker = db.prepare('SELECT * FROM workers WHERE id = ?')

  function record(kind: ActivityEvent['kind'], actor: string, worker: Worker | null, at: string, key?: string) {
    addEvent.run(kind, actor, worker?.id ?? null, worker?.name ?? null, at, key ?? null)
    bumpRevision.run()
  }

  function requireWorker(workerId: string): Worker {
    const worker = findWorker.get(workerId) as unknown as Worker | undefined
    if (!worker) throw new StaffingError('WORKER_NOT_FOUND', 'Worker not found on this shift.')
    return worker
  }

  function readSnapshot(shiftId: string): Snapshot {
    requireShift(shiftId)
    // All three reads share the caller's transaction, even for an empty roster.
    const revision = Number(db.prepare('SELECT revision FROM state WHERE id = 1').get()!.revision)
    const workers = db.prepare('SELECT * FROM workers ORDER BY id').all() as unknown as Worker[]
    const activity = db.prepare('SELECT id, kind, actor, workerId, workerName, occurredAt FROM activity ORDER BY occurredAt DESC, id DESC').all() as unknown as ActivityEvent[]
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
        const receipt = db.prepare('SELECT workerId, invitedAt FROM invitation_receipts WHERE requestKey = ?').get(key)
        if (receipt) {
          if (receipt.workerId !== workerId) throw new StaffingError('REQUEST_KEY_REUSED', 'This key identifies a different invitation.')
          const invitation = { shiftId, workerId, invitedAt: String(receipt.invitedAt) }
          return { changed: false, result: { invitation, snapshot: readSnapshot(shiftId) } }
        }
      }
      const worker = requireWorker(workerId)
      const invitedAt = invitationTime(worker, now)
      const changed = worker.participation === 'uninvited'
      if (changed) {
        db.prepare("UPDATE workers SET participation = 'invited', invitedAt = ? WHERE id = ?").run(invitedAt, workerId)
        record('invited', demoManager, worker, invitedAt)
      }
      if (key) db.prepare('INSERT INTO invitation_receipts(requestKey, workerId, invitedAt) VALUES (?, ?, ?)').run(key, workerId, invitedAt)
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
      const prior = db.prepare('SELECT kind FROM activity WHERE workerId = ? AND requestKey = ?').get(workerId, key)
      if (prior) {
        if (prior.kind !== kind) throw new StaffingError('REQUEST_KEY_REUSED', 'This request key already identifies another action.')
        return { changed: false, snapshot: readSnapshot(shiftId) }
      }
      if (!availableActions(worker).includes(action)) {
        throw new StaffingError('INVALID_TRANSITION', 'This action is unavailable for the current shift status.')
      }
      const at = now()
      if (kind === 'checked_in') {
        db.prepare('UPDATE workers SET attendance = ?, checkedInAt = ? WHERE id = ?').run(kind, at, workerId)
      } else if (kind === 'checked_out') {
        db.prepare('UPDATE workers SET attendance = ?, checkedOutAt = ? WHERE id = ?').run(kind, at, workerId)
      } else {
        db.prepare('UPDATE workers SET participation = ? WHERE id = ?').run(kind, workerId)
      }
      record(kind, worker.name, worker, at, key)
      return { changed: true, snapshot: readSnapshot(shiftId) }
    })
  }

  function reset(role: Role) {
    requireManager(role)
    return transaction('write', () => {
      db.exec(seedRoster)
      record('reset', demoManager, null, now())
      return readSnapshot(shift.id)
    })
  }

  return { snapshot, invite, workerAction, reset, close: () => db.close() }
}
