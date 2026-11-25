import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { demoManager, type ActivityEvent, type Assignment, type Shift, type Worker } from '../../shared/types.ts'

// Raise this when the schema changes. A database with another version is refused rather than migrated.
const schemaVersion = 3

// Workers are people and shifts are events. An assignment connects one worker to one shift and holds
// that worker's invitation, decision and attendance for it, so each shift has its own status.
const schema = `
  CREATE TABLE shifts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    startsAt TEXT NOT NULL,
    endsAt TEXT NOT NULL,
    timeZone TEXT NOT NULL,
    requiredWorkers INTEGER NOT NULL CHECK (requiredWorkers > 0),
    CHECK (startsAt < endsAt)
  ) STRICT;
  CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT;
  CREATE TABLE assignments (
    shiftId TEXT NOT NULL REFERENCES shifts(id),
    workerId TEXT NOT NULL REFERENCES workers(id),
    participation TEXT NOT NULL CHECK (participation IN ('invited','accepted','declined','cancelled')),
    attendance TEXT NOT NULL CHECK (attendance IN ('not_started','checked_in','checked_out')),
    invitedAt TEXT NOT NULL,
    checkedInAt TEXT,
    checkedOutAt TEXT,
    PRIMARY KEY (shiftId, workerId),
    CHECK (attendance = 'not_started' OR participation = 'accepted'),
    CHECK ((attendance = 'not_started') = (checkedInAt IS NULL)),
    CHECK ((attendance = 'checked_out') = (checkedOutAt IS NOT NULL))
  ) STRICT;
  CREATE TABLE invitation_receipts (
    requestKey TEXT PRIMARY KEY,
    shiftId TEXT NOT NULL,
    workerId TEXT NOT NULL,
    invitedAt TEXT NOT NULL
  ) STRICT;
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('invited','accepted','declined','cancelled','checked_in','checked_out','reset')),
    actor TEXT NOT NULL,
    shiftId TEXT REFERENCES shifts(id),
    workerId TEXT,
    workerName TEXT,
    occurredAt TEXT NOT NULL,
    requestKey TEXT,
    UNIQUE(shiftId, workerId, requestKey)
  ) STRICT;
  CREATE TABLE state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL
  ) STRICT;
`

// People and events are reference data: the app reads them, and reset leaves them alone.
const seedReferenceData = `
  INSERT INTO shifts (id, title, location, startsAt, endsAt, timeZone, requiredWorkers)
  VALUES ('shift-001', 'Evening event crew', 'Harbor Hall, East Entrance',
          '2026-11-24T22:00:00.000Z', '2026-11-25T03:00:00.000Z', 'America/Toronto', 3);
  INSERT INTO workers (id, name)
  VALUES ('worker-001', 'Jordan Lee'), ('worker-002', 'Alex Chen'), ('worker-003', 'Alex Rivera');
`

// Jordan has accepted and checked in. Both Alexes have no assignment yet, so they are uninvited.
const seedAssignments = `
  DELETE FROM assignments;
  INSERT INTO assignments (shiftId, workerId, participation, attendance, invitedAt, checkedInAt, checkedOutAt)
  VALUES ('shift-001', 'worker-001', 'accepted', 'checked_in',
          '2026-11-23T16:00:00.000Z', '2026-11-24T21:55:00.000Z', NULL);
`

// Jordan's history up to the seeded check-in. Reset keeps the timeline, so this runs only for a new database.
const seedActivity: [ActivityEvent['kind'], string, string, string, string, string][] = [
  ['invited', demoManager, 'shift-001', 'worker-001', 'Jordan Lee', '2026-11-23T16:00:00.000Z'],
  ['accepted', 'Jordan Lee', 'shift-001', 'worker-001', 'Jordan Lee', '2026-11-23T16:18:00.000Z'],
  ['checked_in', 'Jordan Lee', 'shift-001', 'worker-001', 'Jordan Lee', '2026-11-24T21:55:00.000Z'],
]

export function openShiftDatabase(databasePath: string) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON')

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

  try {
    transaction('write', () => {
      // Only an empty file counts as new. Anything else must carry the current schema version.
      const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get()
      if (fresh) {
        db.exec(schema)
        db.exec(`PRAGMA user_version = ${schemaVersion}`)
        db.exec('INSERT INTO state VALUES (1, 1)')
        db.exec(seedReferenceData)
        db.exec(seedAssignments)
        const addSeedEvent = db.prepare(
          'INSERT INTO activity (kind, actor, shiftId, workerId, workerName, occurredAt) VALUES (?, ?, ?, ?, ?, ?)',
        )
        for (const event of seedActivity) addSeedEvent.run(...event)
      } else if (db.prepare('PRAGMA user_version').get()?.user_version !== schemaVersion) {
        throw new Error(
          `${databasePath} was created by another version of this demo. ` +
            'Delete it (with Docker: docker compose down -v) and start again from the seed.',
        )
      }
    })
  } catch (error) {
    db.close()
    throw error
  }

  // Every query the service needs. Prepared once, after the schema exists.
  const sql = {
    revision: db.prepare('SELECT revision FROM state WHERE id = 1'),
    bumpRevision: db.prepare('UPDATE state SET revision = revision + 1'),
    shifts: db.prepare('SELECT * FROM shifts ORDER BY startsAt, id'),
    shift: db.prepare('SELECT * FROM shifts WHERE id = ?'),
    workers: db.prepare('SELECT id, name FROM workers ORDER BY id'),
    worker: db.prepare('SELECT id, name FROM workers WHERE id = ?'),
    assignments: db.prepare('SELECT * FROM assignments WHERE shiftId = ? ORDER BY workerId'),
    assignment: db.prepare('SELECT * FROM assignments WHERE shiftId = ? AND workerId = ?'),
    // A shift's timeline includes demo resets, which apply to every shift.
    activity: db.prepare(
      `SELECT id, kind, actor, shiftId, workerId, workerName, occurredAt FROM activity
       WHERE shiftId = ? OR shiftId IS NULL ORDER BY occurredAt DESC, id DESC`,
    ),
    addEvent: db.prepare(
      `INSERT INTO activity(kind, actor, shiftId, workerId, workerName, occurredAt, requestKey)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    eventForKey: db.prepare('SELECT kind FROM activity WHERE shiftId = ? AND workerId = ? AND requestKey = ?'),
    receipt: db.prepare('SELECT shiftId, workerId, invitedAt FROM invitation_receipts WHERE requestKey = ?'),
    addReceipt: db.prepare(
      'INSERT INTO invitation_receipts(requestKey, shiftId, workerId, invitedAt) VALUES (?, ?, ?, ?)',
    ),
    addAssignment: db.prepare(
      `INSERT INTO assignments (shiftId, workerId, participation, attendance, invitedAt)
       VALUES (?, ?, 'invited', 'not_started', ?)`,
    ),
    setParticipation: db.prepare('UPDATE assignments SET participation = ? WHERE shiftId = ? AND workerId = ?'),
    checkIn: db.prepare(
      "UPDATE assignments SET attendance = 'checked_in', checkedInAt = ? WHERE shiftId = ? AND workerId = ?",
    ),
    checkOut: db.prepare(
      "UPDATE assignments SET attendance = 'checked_out', checkedOutAt = ? WHERE shiftId = ? AND workerId = ?",
    ),
  }

  return {
    transaction,
    close: () => db.close(),
    revision: () => Number(sql.revision.get()!.revision),
    shifts: () => sql.shifts.all() as unknown as Shift[],
    findShift: (id: string) => sql.shift.get(id) as unknown as Shift | undefined,
    workers: () => sql.workers.all() as unknown as Worker[],
    findWorker: (id: string) => sql.worker.get(id) as unknown as Worker | undefined,
    assignments: (shiftId: string) => sql.assignments.all(shiftId) as unknown as Assignment[],
    findAssignment: (shiftId: string, workerId: string) =>
      sql.assignment.get(shiftId, workerId) as unknown as Assignment | undefined,
    activity: (shiftId: string) => sql.activity.all(shiftId) as unknown as ActivityEvent[],
    // Every recorded event advances the revision that clients use to discard stale snapshots.
    recordEvent(
      kind: ActivityEvent['kind'],
      actor: string,
      shiftId: string | null,
      worker: Worker | null,
      at: string,
      key?: string,
    ) {
      sql.addEvent.run(kind, actor, shiftId, worker?.id ?? null, worker?.name ?? null, at, key ?? null)
      sql.bumpRevision.run()
    },
    eventKindForKey: (shiftId: string, workerId: string, key: string) =>
      sql.eventForKey.get(shiftId, workerId, key)?.kind as ActivityEvent['kind'] | undefined,
    invitationReceipt(key: string) {
      const row = sql.receipt.get(key)
      return row && { shiftId: String(row.shiftId), workerId: String(row.workerId), invitedAt: String(row.invitedAt) }
    },
    saveInvitationReceipt: (key: string, shiftId: string, workerId: string, invitedAt: string) => {
      sql.addReceipt.run(key, shiftId, workerId, invitedAt)
    },
    addAssignment: (shiftId: string, workerId: string, invitedAt: string) => {
      sql.addAssignment.run(shiftId, workerId, invitedAt)
    },
    setParticipation: (shiftId: string, workerId: string, participation: Assignment['participation']) => {
      sql.setParticipation.run(participation, shiftId, workerId)
    },
    checkIn: (shiftId: string, workerId: string, at: string) => {
      sql.checkIn.run(at, shiftId, workerId)
    },
    checkOut: (shiftId: string, workerId: string, at: string) => {
      sql.checkOut.run(at, shiftId, workerId)
    },
    restoreSeedAssignments: () => db.exec(seedAssignments),
  }
}
