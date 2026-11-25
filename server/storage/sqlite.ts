import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { demoManager, type ActivityEvent, type Worker } from '../../shared/types.ts'

// Raise this when the schema changes. A database with another version is refused rather than migrated.
const schemaVersion = 2

// The demo has one fixed shift. Each row records one worker's assignment to it.
const schema = `
  CREATE TABLE IF NOT EXISTS invitation_receipts (
    requestKey TEXT PRIMARY KEY,
    workerId TEXT NOT NULL,
    invitedAt TEXT NOT NULL
  ) STRICT;
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

const seedRoster = `
  DELETE FROM workers;
  INSERT INTO workers (id, name, participation, attendance, invitedAt, checkedInAt, checkedOutAt)
  VALUES
    ('worker-001', 'Jordan Lee', 'accepted', 'checked_in', '2026-11-23T16:00:00.000Z', '2026-11-24T21:55:00.000Z', NULL),
    ('worker-002', 'Alex Chen', 'uninvited', 'not_started', NULL, NULL, NULL),
    ('worker-003', 'Alex Rivera', 'uninvited', 'not_started', NULL, NULL, NULL);
`

// Jordan's history up to the seeded check-in. Reset keeps the timeline, so this runs only for a new database.
const seedActivity: [ActivityEvent['kind'], string, string, string, string][] = [
  ['invited', demoManager, 'worker-001', 'Jordan Lee', '2026-11-23T16:00:00.000Z'],
  ['accepted', 'Jordan Lee', 'worker-001', 'Jordan Lee', '2026-11-23T16:18:00.000Z'],
  ['checked_in', 'Jordan Lee', 'worker-001', 'Jordan Lee', '2026-11-24T21:55:00.000Z'],
]

export function openShiftDatabase(databasePath: string) {
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

  try {
    transaction('write', () => {
      // Only an empty file counts as new. Anything else must carry the current schema version.
      const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get()
      if (fresh) {
        db.exec(schema)
        db.exec(`PRAGMA user_version = ${schemaVersion}`)
        db.exec('INSERT INTO state VALUES (1, 1)')
        db.exec(seedRoster)
        const addSeedEvent = db.prepare(
          'INSERT INTO activity (kind, actor, workerId, workerName, occurredAt) VALUES (?, ?, ?, ?, ?)',
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
    workers: db.prepare('SELECT * FROM workers ORDER BY id'),
    worker: db.prepare('SELECT * FROM workers WHERE id = ?'),
    activity: db.prepare(
      'SELECT id, kind, actor, workerId, workerName, occurredAt FROM activity ORDER BY occurredAt DESC, id DESC',
    ),
    addEvent: db.prepare(
      'INSERT INTO activity(kind, actor, workerId, workerName, occurredAt, requestKey) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    eventForKey: db.prepare('SELECT kind FROM activity WHERE workerId = ? AND requestKey = ?'),
    receipt: db.prepare('SELECT workerId, invitedAt FROM invitation_receipts WHERE requestKey = ?'),
    addReceipt: db.prepare('INSERT INTO invitation_receipts(requestKey, workerId, invitedAt) VALUES (?, ?, ?)'),
    markInvited: db.prepare("UPDATE workers SET participation = 'invited', invitedAt = ? WHERE id = ?"),
    setParticipation: db.prepare('UPDATE workers SET participation = ? WHERE id = ?'),
    checkIn: db.prepare("UPDATE workers SET attendance = 'checked_in', checkedInAt = ? WHERE id = ?"),
    checkOut: db.prepare("UPDATE workers SET attendance = 'checked_out', checkedOutAt = ? WHERE id = ?"),
  }

  return {
    transaction,
    close: () => db.close(),
    revision: () => Number(sql.revision.get()!.revision),
    workers: () => sql.workers.all() as unknown as Worker[],
    findWorker: (id: string) => sql.worker.get(id) as unknown as Worker | undefined,
    activity: () => sql.activity.all() as unknown as ActivityEvent[],
    // Every recorded event advances the revision that clients use to discard stale snapshots.
    recordEvent(kind: ActivityEvent['kind'], actor: string, worker: Worker | null, at: string, key?: string) {
      sql.addEvent.run(kind, actor, worker?.id ?? null, worker?.name ?? null, at, key ?? null)
      sql.bumpRevision.run()
    },
    eventKindForKey: (workerId: string, key: string) =>
      sql.eventForKey.get(workerId, key)?.kind as ActivityEvent['kind'] | undefined,
    invitationReceipt(key: string) {
      const row = sql.receipt.get(key)
      return row && { workerId: String(row.workerId), invitedAt: String(row.invitedAt) }
    },
    saveInvitationReceipt: (key: string, workerId: string, invitedAt: string) => {
      sql.addReceipt.run(key, workerId, invitedAt)
    },
    markInvited: (workerId: string, at: string) => {
      sql.markInvited.run(at, workerId)
    },
    setParticipation: (workerId: string, participation: Worker['participation']) => {
      sql.setParticipation.run(participation, workerId)
    },
    checkIn: (workerId: string, at: string) => {
      sql.checkIn.run(at, workerId)
    },
    checkOut: (workerId: string, at: string) => {
      sql.checkOut.run(at, workerId)
    },
    restoreSeedRoster: () => db.exec(seedRoster),
  }
}
