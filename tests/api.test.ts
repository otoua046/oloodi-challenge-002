import assert from 'node:assert/strict'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { openStaffing } from '../server/staffing-service.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createApp } from '../server/app.ts'
import type { InviteResponse, Snapshot } from '../shared/types.ts'

const shift = '/api/shifts/shift-001'
const invite = (id: string) => `${shift}/workers/${id}/invite`
const reset = '/api/demo/reset'

async function start(databasePath = ':memory:', now?: () => string, previewPassword?: string) {
  const { server, close } = createApp({ databasePath, now, previewPassword })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
  } catch (error) {
    await close()
    throw error
  }
  const { port } = server.address() as AddressInfo
  function request(
    path: string,
    method = 'GET',
    role?: string,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      signal,
      headers: role === undefined ? headers : { ...headers, 'X-Demo-Role': role },
    })
  }
  return { request, close }
}

async function fixture(t: TestContext, now?: () => string) {
  const app = await start(':memory:', now)
  t.after(app.close)
  return app.request
}

async function success<T>(response: Response): Promise<T> {
  const body = await response.text()
  assert.equal(response.status, 200, body)
  return JSON.parse(body) as T
}

async function failure(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  assert.partialDeepStrictEqual(await response.json(), { error: { code } })
}

test('both roles can read the same seeded shift and distinguish the two Alexes', async t => {
  const request = await fixture(t)
  const seed = await success<Snapshot>(await request(shift, 'GET', 'viewer'))
  assert.deepEqual(await success(await request(shift, 'GET', 'manager')), seed)
  assert.deepEqual(await success(await request(shift)), seed)
  assert.equal(seed.shift.requiredWorkers, 3)
  assert.deepEqual(seed.counts, { filled: 1, remaining: 2, checkedIn: 1, checkedOut: 0 })
  const roster = seed.workers.map(({ id, name, participation, attendance }) => [id, name, participation, attendance])
  assert.deepEqual(roster.sort(), [
    ['worker-001', 'Jordan Lee', 'accepted', 'checked_in'],
    ['worker-002', 'Alex Chen', 'uninvited', 'not_started'],
    ['worker-003', 'Alex Rivera', 'uninvited', 'not_started'],
  ])
})

test('writes require a manager and failures leave the snapshot unchanged', async t => {
  const request = await fixture(t)
  const before = await success(await request(shift))
  for (const path of [invite('worker-002'), reset]) {
    for (const role of [undefined, 'viewer']) {
      await failure(await request(path, 'POST', role), 403, 'FORBIDDEN')
    }
    await failure(await request(path, 'POST', 'owner'), 400, 'INVALID_ROLE')
  }
  await failure(await request('/api/shifts/unknown'), 404, 'SHIFT_NOT_FOUND')
  await failure(
    await request('/api/shifts/unknown/workers/worker-002/invite', 'POST', 'manager'),
    404,
    'SHIFT_NOT_FOUND',
  )
  await failure(await request(invite('missing'), 'POST', 'manager'), 404, 'WORKER_NOT_FOUND')
  await failure(await request(invite('worker-001'), 'POST', 'manager'), 409, 'INVALID_TRANSITION')
  assert.deepEqual(await success(await request(shift)), before)
})

test('repeat invite preserves the first timestamp, revision, and staffing counts', async t => {
  let time = '2027-01-01T17:00:00.000Z'
  const request = await fixture(t, () => time)
  const seed = await success<Snapshot>(await request(shift))
  const first = await success<InviteResponse>(await request(invite('worker-002'), 'POST', 'manager'))
  assert.deepEqual(first.invitation, { workerId: 'worker-002', shiftId: 'shift-001', invitedAt: time })
  assert.partialDeepStrictEqual(
    first.snapshot.workers.find(w => w.id === 'worker-002'),
    {
      participation: 'invited',
      attendance: 'not_started',
      invitedAt: time,
    },
  )
  assert.equal(first.snapshot.revision, seed.revision + 1)
  assert.deepEqual(first.snapshot.counts, seed.counts)
  time = '2027-01-02T17:00:00.000Z'
  assert.deepEqual(await success(await request(invite('worker-002'), 'POST', 'manager')), first)
  assert.deepEqual(await success(await request(shift)), first.snapshot)
})

test('interleaved invitations produce one mutation per worker; reset restores the seed', async t => {
  const request = await fixture(t)
  const seed = await success<Snapshot>(await request(shift))
  const ids = ['worker-002', 'worker-003', 'worker-002', 'worker-003', 'worker-003', 'worker-002']
  const receipts = await Promise.all(
    ids.map(async id => {
      const result = await success<InviteResponse>(await request(invite(id), 'POST', 'manager'))
      return result.invitation
    }),
  )
  const after = await success<Snapshot>(await request(shift))
  assert.equal(after.revision, seed.revision + 2)
  assert.deepEqual(after.counts, seed.counts)
  ids.forEach((id, index) => {
    const worker = after.workers.find(w => w.id === id)
    assert.ok(worker)
    assert.equal(worker.participation, 'invited')
    assert.deepEqual(receipts[index], { shiftId: seed.shift.id, workerId: id, invitedAt: worker.invitedAt })
  })
  const restored = await success<Snapshot>(await request(reset, 'POST', 'manager'))
  assert.deepEqual(restored, { ...seed, activity: restored.activity, revision: after.revision + 1 })
  assert.equal(restored.activity.length, seed.activity.length + 3)
  assert.equal(restored.activity.filter(event => event.kind === 'reset').length, 1)
  assert.deepEqual(await success(await request(shift)), restored)
})

test('a restart preserves committed invitations and accepts their retries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'staffing-api-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'test.sqlite')
  const first = await start(file)
  let original: InviteResponse
  try {
    original = await success<InviteResponse>(await first.request(invite('worker-003'), 'POST', 'manager'))
  } finally {
    await first.close()
  }

  const reopened = await start(file)
  try {
    assert.deepEqual(await success(await reopened.request(shift)), original.snapshot)
    assert.deepEqual(await success(await reopened.request(invite('worker-003'), 'POST', 'manager')), original)
  } finally {
    await reopened.close()
  }
})

test('activity records the seeded timeline and one entry per successful invitation', async t => {
  const time = '2026-11-25T21:42:00.000Z'
  const request = await fixture(t, () => time)
  const seed = await success<Snapshot>(await request(shift))
  assert.deepEqual(
    seed.activity.map(e => [e.kind, e.actor, e.workerName]),
    [
      ['checked_in', 'Jordan Lee', 'Jordan Lee'],
      ['accepted', 'Jordan Lee', 'Jordan Lee'],
      ['invited', 'Maya Patel', 'Jordan Lee'],
    ],
  )
  await failure(await request(invite('worker-002'), 'POST', 'viewer'), 403, 'FORBIDDEN')
  const first = await success<InviteResponse>(await request(invite('worker-002'), 'POST', 'manager'))
  assert.equal(first.snapshot.activity.length, 4)
  assert.partialDeepStrictEqual(first.snapshot.activity[0], {
    kind: 'invited',
    actor: 'Maya Patel',
    workerName: 'Alex Chen',
    workerId: 'worker-002',
    occurredAt: time,
  })
  const retry = await success<InviteResponse>(await request(invite('worker-002'), 'POST', 'manager'))
  assert.deepEqual(retry.snapshot.activity, first.snapshot.activity)
})

test('worker decisions enforce identity, preserve retries, and update counts and history', async t => {
  const request = await fixture(t)
  const id = 'worker-002'
  const action = (name: string, key: string, actor = id, role = 'worker') =>
    request(shift + '/workers/' + id + '/' + name, 'POST', role, {
      'X-Demo-Worker-Id': actor,
      'Idempotency-Key': key,
    })
  const post = async (name: string, key: string) =>
    success<{ changed: boolean; snapshot: Snapshot }>(await action(name, key))

  await failure(await action('accept', 'a'), 409, 'INVALID_TRANSITION')
  await success(await request(invite(id), 'POST', 'manager'))
  for (const role of ['manager', 'viewer']) await failure(await action('accept', 'a', id, role), 403, 'FORBIDDEN')
  await failure(await action('accept', 'a', 'worker-003'), 403, 'FORBIDDEN')
  await failure(await action('check-out', 'early'), 409, 'INVALID_TRANSITION')
  const accepted = await post('accept', 'a')
  assert.equal(accepted.snapshot.counts.filled, 2)
  const cancelled = await post('cancel', 'b')
  assert.equal(cancelled.snapshot.counts.filled, 1)
  assert.deepEqual(await post('accept', 'a'), { changed: false, snapshot: cancelled.snapshot })
  const reaccepted = await post('accept', 'c')
  assert.equal(reaccepted.snapshot.counts.filled, 2)
  const arrived = await post('check-in', 'd')
  assert.equal(arrived.snapshot.counts.checkedIn, 2)
  await failure(await action('cancel', 'late'), 409, 'INVALID_TRANSITION')
  const finished = await post('check-out', 'e')
  assert.deepEqual(finished.snapshot.counts, { filled: 2, remaining: 1, checkedIn: 1, checkedOut: 1 })
  assert.deepEqual(await post('check-out', 'e'), { changed: false, snapshot: finished.snapshot })
  assert.deepEqual(
    finished.snapshot.activity.filter(e => e.actor === 'Alex Chen').map(e => e.kind),
    ['checked_out', 'checked_in', 'accepted', 'cancelled', 'accepted'],
  )
  await success(await request(reset, 'POST', 'manager'))
  await success(await request(invite(id), 'POST', 'manager'))
  const declined = await post('decline', 'f')
  assert.equal(declined.snapshot.workers.find(w => w.id === id)?.participation, 'declined')
  assert.equal(declined.snapshot.counts.filled, 1)
  await failure(await action('check-in', 'g'), 409, 'INVALID_TRANSITION')
})

test('a keyed manager invitation can be retried after acceptance and reset', async t => {
  const request = await fixture(t)
  const id = 'worker-002'
  const headers = { 'Idempotency-Key': 'first-invite' }
  const send = () => request(invite(id), 'POST', 'manager', headers)
  const original = await success<InviteResponse>(await send())
  const accepted = await success<{ snapshot: Snapshot }>(
    await request(shift + '/workers/' + id + '/accept', 'POST', 'worker', {
      'X-Demo-Worker-Id': id,
      'Idempotency-Key': 'accepted',
    }),
  )
  assert.deepEqual(await success(await send()), { invitation: original.invitation, snapshot: accepted.snapshot })
  const restored = await success<Snapshot>(await request(reset, 'POST', 'manager'))
  assert.deepEqual(await success(await send()), { invitation: original.invitation, snapshot: restored })
  await failure(await request(invite('worker-003'), 'POST', 'manager', headers), 409, 'REQUEST_KEY_REUSED')
  await failure(await request(invite(id), 'POST', 'viewer', headers), 403, 'FORBIDDEN')
})

test('a failed write rolls back the whole invitation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'staffing-rollback-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'shift.db')
  const staffing = openStaffing(file)
  const sqlite = new DatabaseSync(file)
  try {
    const before = staffing.snapshot('shift-001')
    sqlite.exec(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON invitation_receipts BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    )
    assert.throws(() => staffing.invite('manager', 'shift-001', 'worker-003', 'new-invite'), /write failed/)
    assert.deepEqual(staffing.snapshot('shift-001'), before)
    sqlite.exec('DROP TRIGGER reject_receipt')
    const invited = staffing.invite('manager', 'shift-001', 'worker-003', 'new-invite')
    assert.equal(invited.result.snapshot.activity.length, before.activity.length + 1)
  } finally {
    staffing.close()
    sqlite.close()
  }
})

test('a database from another demo version or another app is refused with a clear message', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'staffing-old-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, setup] of [
    ['older', 'PRAGMA user_version = 1'],
    ['newer', 'PRAGMA user_version = 3'],
  ] as const) {
    const file = join(dir, name + '.db')
    openStaffing(file).close()
    const sqlite = new DatabaseSync(file)
    sqlite.exec(setup)
    sqlite.close()
    assert.throws(() => openStaffing(file), /created by another version of this demo/)
  }
  const foreign = join(dir, 'foreign.db')
  const sqlite = new DatabaseSync(foreign)
  sqlite.exec('CREATE TABLE notes (body TEXT)')
  sqlite.close()
  assert.throws(() => openStaffing(foreign), /created by another version of this demo/)
})

test('a large shift history and subsequent live update arrive on the same connection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'staffing-stream-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'shift.db')
  openStaffing(file).close()
  const db = new DatabaseSync(file)
  try {
    db.exec(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1800)
      INSERT INTO activity(kind,actor,occurredAt)
      SELECT 'reset','Demo manager','2026-11-22T12:00:00.000Z' FROM n`)
  } finally {
    db.close()
  }
  const app = await start(file)
  const abort = new AbortController()
  try {
    const response = await app.request(
      shift + '/events',
      'GET',
      undefined,
      {},
      AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
    )
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buffered = ''
    async function nextSnapshot(): Promise<Snapshot> {
      while (!buffered.includes('\n\n')) {
        const part = await reader.read()
        assert.ok(!part.done, 'stream closed before delivering a snapshot')
        buffered += part.value
      }
      const end = buffered.indexOf('\n\n')
      const frame = buffered.slice(0, end)
      buffered = buffered.slice(end + 2)
      const data = frame.split('\n').find(line => line.startsWith('data: '))
      assert.ok(data)
      return JSON.parse(data.slice(6))
    }
    const initial = await nextSnapshot()
    assert.equal(initial.activity.length, 1803)
    const reply = await success<InviteResponse>(await app.request(invite('worker-002'), 'POST', 'manager'))
    assert.deepEqual(await nextSnapshot(), reply.snapshot)
  } finally {
    abort.abort()
    await app.close()
  }
})

test('a preview password closes every route until the browser supplies it', async t => {
  const app = await start(':memory:', undefined, 'tide-preview')
  t.after(app.close)
  const basic = (credentials: string) => ({ Authorization: 'Basic ' + Buffer.from(credentials).toString('base64') })

  for (const path of ['/', shift, '/assets/app.js']) {
    const response = await app.request(path)
    await failure(response, 401, 'UNAUTHORIZED')
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic realm="Tideway preview"/)
  }
  await failure(await app.request(invite('worker-002'), 'POST', 'manager', basic('maya:wrong')), 401, 'UNAUTHORIZED')
  await failure(
    await app.request(shift, 'GET', undefined, { Authorization: 'Bearer tide-preview' }),
    401,
    'UNAUTHORIZED',
  )

  await success(await app.request(shift, 'GET', undefined, basic('anyone:tide-preview')))
  await success(await app.request(invite('worker-002'), 'POST', 'manager', basic(':tide-preview')))
})
