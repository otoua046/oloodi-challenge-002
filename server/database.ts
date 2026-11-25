import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import { demoManager } from '../shared/types.ts'
import type { ActivityEvent, InviteResponse, Role, Snapshot, Worker } from '../shared/types.ts'
import { ApiError, invitationTime, requireManager, requireShift, shift, staffingCounts } from './staffing.ts'

// The demo has one fixed shift. Each row records one worker's assignment to it.
const schema = `
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('invited','accepted','declined','cancelled','checked_in','checked_out','reset')),
    actor TEXT NOT NULL,
    workerId TEXT,
    workerName TEXT,
    occurredAt TEXT NOT NULL,
    requestKey TEXT,
    UNIQUE(workerId, requestKey)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    participation TEXT NOT NULL CHECK (participation IN ('uninvited','invited','accepted','declined','cancelled')),
    attendance TEXT NOT NULL CHECK (attendance IN ('not_started','checked_in','checked_out')),
    invitedAt TEXT,
    checkedInAt TEXT,
    checkedOutAt TEXT,
    CHECK ((participation = 'uninvited') = (invitedAt IS NULL)),
    CHECK (attendance = 'not_started' OR participation = 'accepted'),
    CHECK ((attendance = 'not_started') = (checkedInAt IS NULL)),
    CHECK ((attendance = 'checked_out') = (checkedOutAt IS NOT NULL))
  ) STRICT;
`

const seed = `
  DELETE FROM workers;
  INSERT INTO workers (id, name, participation, attendance, invitedAt, checkedInAt, checkedOutAt)
  VALUES
    ('worker-001', 'Jordan Lee', 'accepted', 'checked_in', '2026-11-23T16:00:00.000Z', '2026-11-24T21:55:00.000Z', NULL),
    ('worker-002', 'Alex Chen', 'uninvited', 'not_started', NULL, NULL, NULL),
    ('worker-003', 'Alex Rivera', 'uninvited', 'not_started', NULL, NULL, NULL);
`

export function openStaffing(databasePath: string, now: () => string = () => new Date().toISOString()) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA busy_timeout = 3000')

  function transaction<T>(mode: 'read' | 'write', operation: () => T): T {
    db.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  transaction('write', () => {
    const legacy = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workers'").get())
    db.exec(schema)
    // Older demos used narrower CHECK constraints. Rebuild both tables atomically, retaining their history.
    const version = db.prepare('PRAGMA user_version').get()?.user_version
    if (legacy && version === 0) {
      db.exec('ALTER TABLE workers RENAME TO workers_v0; ALTER TABLE activity RENAME TO activity_v0')
      db.exec(schema)
      db.exec(`
        INSERT INTO workers SELECT * FROM workers_v0;
        INSERT INTO activity(id, kind, actor, workerId, workerName, occurredAt)
          SELECT id, kind, actor, workerId, workerName, occurredAt FROM activity_v0;
        DROP TABLE workers_v0;
        DROP TABLE activity_v0;
      `)
    }
    if (version === 0) db.exec('PRAGMA user_version = 1')
    if (!db.prepare('SELECT revision FROM state').get()) {
      db.exec('INSERT INTO state VALUES (1, 1)')
      db.exec(seed)
    }
    if (!db.prepare('SELECT 1 FROM activity LIMIT 1').get()) {
      // Jordan is the fixed demo fixture. Earlier versions recorded only the manager role for other invites.
      const insert = db.prepare('INSERT INTO activity(kind, actor, workerId, workerName, occurredAt) VALUES (?, ?, ?, ?, ?)')
      const workers = db.prepare('SELECT * FROM workers').all() as unknown as Worker[]
      for (const worker of workers) {
        const jordan = worker.id === 'worker-001'
        if (worker.invitedAt) {
          insert.run('invited', legacy && !jordan ? 'Demo manager' : demoManager, worker.id, worker.name, worker.invitedAt)
        }
        if (jordan && worker.participation === 'accepted') {
          insert.run('accepted', worker.name, worker.id, worker.name, '2026-11-23T16:18:00.000Z')
        }
        if (worker.checkedInAt) insert.run('checked_in', worker.name, worker.id, worker.name, worker.checkedInAt)
        if (worker.checkedOutAt) insert.run('checked_out', worker.name, worker.id, worker.name, worker.checkedOutAt)
      }
    }
  })

  const addEvent = db.prepare('INSERT INTO activity(kind, actor, workerId, workerName, occurredAt) VALUES (?, ?, ?, ?, ?)')

  function readSnapshot(shiftId: string): Snapshot {
    requireShift(shiftId)
    // One SELECT gives the roster and its revision from the same database snapshot.
    const rows = db.prepare(`
      SELECT workers.*, state.revision FROM workers CROSS JOIN state ORDER BY workers.id
    `).all() as unknown as (Worker & { revision: number })[]
    const workers = rows.map(({ revision: _revision, ...worker }) => worker)
    const activity = db.prepare('SELECT id, kind, actor, workerId, workerName, occurredAt FROM activity ORDER BY occurredAt DESC, id DESC').all() as unknown as ActivityEvent[]
    return { shift, workers, activity, revision: rows[0]!.revision, counts: staffingCounts(workers) }
  }

  function snapshot(shiftId: string) {
    return transaction('read', () => readSnapshot(shiftId))
  }

  function invite(role: Role, shiftId: string, workerId: string) {
    requireManager(role)
    requireShift(shiftId)
    return transaction('write', () => {
      const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as unknown as Worker | undefined
      if (!worker) throw new ApiError(404, 'WORKER_NOT_FOUND', 'Worker not found on this shift.')
      const invitedAt = invitationTime(worker, now)
      const changed = worker.participation === 'uninvited'
      if (changed) {
        db.prepare("UPDATE workers SET participation = 'invited', invitedAt = ? WHERE id = ?").run(invitedAt, workerId)
        addEvent.run('invited', demoManager, worker.id, worker.name, invitedAt)
        db.exec('UPDATE state SET revision = revision + 1')
      }
      const result: InviteResponse = { invitation: { shiftId, workerId, invitedAt }, snapshot: readSnapshot(shiftId) }
      return { changed, result }
    })
  }

  function workerAction(role: Role, actorId: string | undefined, shiftId: string, workerId: string, action: WorkerAction, key?: string) {
    if (role !== 'worker' || actorId !== workerId) {
      throw new ApiError(403, 'FORBIDDEN', 'Select this worker to change their shift.')
    }
    requireShift(shiftId)
    if (!key || key.length > 128) throw new ApiError(400, 'INVALID_REQUEST_KEY', 'Supply an Idempotency-Key of up to 128 characters.')
    return transaction('write', () => {
      const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as unknown as Worker | undefined
      if (!worker) throw new ApiError(404, 'WORKER_NOT_FOUND', 'Worker not found on this shift.')
      const kind = workerActions[action].event
      const prior = db.prepare('SELECT kind FROM activity WHERE workerId = ? AND requestKey = ?').get(workerId, key)
      if (prior) {
        if (prior.kind !== kind) throw new ApiError(409, 'REQUEST_KEY_REUSED', 'This request key already identifies another action.')
        return { changed: false, snapshot: readSnapshot(shiftId) }
      }
      if (!availableActions(worker).includes(action)) {
        throw new ApiError(409, 'INVALID_TRANSITION', 'This action is unavailable for the current shift status.')
      }
      const at = now()
      if (kind === 'checked_in') {
        db.prepare('UPDATE workers SET attendance = ?, checkedInAt = ? WHERE id = ?').run(kind, at, workerId)
      } else if (kind === 'checked_out') {
        db.prepare('UPDATE workers SET attendance = ?, checkedOutAt = ? WHERE id = ?').run(kind, at, workerId)
      } else {
        db.prepare('UPDATE workers SET participation = ? WHERE id = ?').run(kind, workerId)
      }
      db.prepare('INSERT INTO activity(kind, actor, workerId, workerName, occurredAt, requestKey) VALUES (?, ?, ?, ?, ?, ?)')
        .run(kind, worker.name, workerId, worker.name, at, key)
      db.exec('UPDATE state SET revision = revision + 1')
      return { changed: true, snapshot: readSnapshot(shiftId) }
    })
  }

  function reset(role: Role) {
    requireManager(role)
    return transaction('write', () => {
      db.exec(seed)
      db.exec('UPDATE state SET revision = revision + 1')
      addEvent.run('reset', demoManager, null, null, now())
      return readSnapshot(shift.id)
    })
  }

  return { snapshot, invite, workerAction, reset, close: () => db.close() }
}
