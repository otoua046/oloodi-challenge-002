import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { demoManager, type Worker } from '../../shared/types.ts'

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

export const seedRoster = `
  DELETE FROM workers;
  INSERT INTO workers (id, name, participation, attendance, invitedAt, checkedInAt, checkedOutAt)
  VALUES
    ('worker-001', 'Jordan Lee', 'accepted', 'checked_in', '2026-11-23T16:00:00.000Z', '2026-11-24T21:55:00.000Z', NULL),
    ('worker-002', 'Alex Chen', 'uninvited', 'not_started', NULL, NULL, NULL),
    ('worker-003', 'Alex Rivera', 'uninvited', 'not_started', NULL, NULL, NULL);
`

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
      const legacy = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workers'").get())
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      if (typeof version !== 'number' || version > 2) throw new Error('Unsupported staffing database version.')
      db.exec(schema)
      // Older demos used narrower CHECK constraints. Rebuild both tables atomically, retaining their history.
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
      if (version < 2) db.exec('PRAGMA user_version = 2')
      if (!db.prepare('SELECT revision FROM state').get()) {
        db.exec('INSERT INTO state VALUES (1, 1)')
        db.exec(seedRoster)
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
  } catch (error) {
    db.close()
    throw error
  }
  return { db, transaction }
}
