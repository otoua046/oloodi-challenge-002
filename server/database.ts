import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { InviteResponse, Role, Snapshot, Worker } from '../shared/types.ts'
import { ApiError, invitationTime, requireManager, requireShift, shift, staffingCounts } from './staffing.ts'

// The demo has one fixed shift. Each row records one worker's assignment to it.
const schema = `
  CREATE TABLE IF NOT EXISTS state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    participation TEXT NOT NULL CHECK (participation IN ('uninvited','invited','accepted')),
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

  function write<T>(operation: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  write(() => {
    db.exec(schema)
    if (!db.prepare('SELECT revision FROM state').get()) {
      db.exec('INSERT INTO state VALUES (1, 1)')
      db.exec(seed)
    }
  })

  function snapshot(shiftId: string): Snapshot {
    requireShift(shiftId)
    // One SELECT gives the roster and its revision from the same database snapshot.
    const rows = db.prepare(`
      SELECT workers.*, state.revision FROM workers CROSS JOIN state ORDER BY workers.id
    `).all() as unknown as (Worker & { revision: number })[]
    const workers = rows.map(({ revision: _revision, ...worker }) => worker)
    return { shift, workers, revision: rows[0]!.revision, counts: staffingCounts(workers) }
  }

  function invite(role: Role, shiftId: string, workerId: string) {
    requireManager(role)
    requireShift(shiftId)
    return write(() => {
      const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as unknown as Worker | undefined
      if (!worker) throw new ApiError(404, 'WORKER_NOT_FOUND', 'Worker not found on this shift.')
      const invitedAt = invitationTime(worker, now)
      const changed = worker.participation === 'uninvited'
      if (changed) {
        db.prepare("UPDATE workers SET participation = 'invited', invitedAt = ? WHERE id = ?").run(invitedAt, workerId)
        db.exec('UPDATE state SET revision = revision + 1')
      }
      const result: InviteResponse = { invitation: { shiftId, workerId, invitedAt }, snapshot: snapshot(shiftId) }
      return { changed, result }
    })
  }

  function reset(role: Role) {
    requireManager(role)
    return write(() => {
      db.exec(seed)
      db.exec('UPDATE state SET revision = revision + 1')
      return snapshot(shift.id)
    })
  }

  return { snapshot, invite, reset, close: () => db.close() }
}
