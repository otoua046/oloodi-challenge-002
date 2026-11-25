import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/app.ts';
import type { InviteResponse, Snapshot } from '../shared/types.ts';

const shift = '/api/shifts/shift-001';
const invite = (id: string) => `${shift}/workers/${id}/invite`;
const reset = '/api/demo/reset';

async function start(databasePath = ':memory:', now?: () => string) {
  const { server, close } = createApp({ databasePath, now });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  } catch (error) {
    await close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  function request(path: string, method = 'GET', role?: string) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: role === undefined ? {} : { 'X-Demo-Role': role },
    });
  }
  return { request, close };
}

async function fixture(t: TestContext, now?: () => string) {
  const app = await start(':memory:', now);
  t.after(app.close);
  return app.request;
}

async function success<T>(response: Response): Promise<T> {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as T;
}

async function failure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.partialDeepStrictEqual(await response.json(), { error: { code } });
}

test('both roles can read the same seeded shift and distinguish the two Alexes', async (t) => {
  const request = await fixture(t);
  const seed = await success<Snapshot>(await request(shift, 'GET', 'viewer'));
  assert.deepEqual(await success(await request(shift, 'GET', 'manager')), seed);
  assert.deepEqual(await success(await request(shift)), seed);
  assert.equal(seed.shift.requiredWorkers, 3);
  assert.deepEqual(seed.counts, { filled: 1, remaining: 2, checkedIn: 1, checkedOut: 0 });
  const roster = seed.workers.map(({ id, name, participation, attendance }) => [id, name, participation, attendance]);
  assert.deepEqual(roster.sort(), [
    ['worker-001', 'Jordan Lee', 'accepted', 'checked_in'],
    ['worker-002', 'Alex Chen', 'uninvited', 'not_started'],
    ['worker-003', 'Alex Rivera', 'uninvited', 'not_started'],
  ]);
});

test('writes require a manager and failures leave the snapshot unchanged', async (t) => {
  const request = await fixture(t);
  const before = await success(await request(shift));
  for (const path of [invite('worker-002'), reset]) {
    for (const role of [undefined, 'viewer']) {
      await failure(await request(path, 'POST', role), 403, 'FORBIDDEN');
    }
    await failure(await request(path, 'POST', 'owner'), 400, 'INVALID_ROLE');
  }
  await failure(await request('/api/shifts/unknown'), 404, 'SHIFT_NOT_FOUND');
  await failure(await request('/api/shifts/unknown/workers/worker-002/invite', 'POST', 'manager'), 404, 'SHIFT_NOT_FOUND');
  await failure(await request(invite('missing'), 'POST', 'manager'), 404, 'WORKER_NOT_FOUND');
  await failure(await request(invite('worker-001'), 'POST', 'manager'), 409, 'INVALID_TRANSITION');
  assert.deepEqual(await success(await request(shift)), before);
});

test('repeat invite preserves the first timestamp, revision, and staffing counts', async (t) => {
  let time = '2027-01-01T17:00:00.000Z';
  const request = await fixture(t, () => time);
  const seed = await success<Snapshot>(await request(shift));
  const first = await success<InviteResponse>(await request(invite('worker-002'), 'POST', 'manager'));
  assert.deepEqual(first.invitation, { workerId: 'worker-002', shiftId: 'shift-001', invitedAt: time });
  assert.partialDeepStrictEqual(first.snapshot.workers.find(w => w.id === 'worker-002'), {
    participation: 'invited', attendance: 'not_started', invitedAt: time,
  });
  assert.equal(first.snapshot.revision, seed.revision + 1);
  assert.deepEqual(first.snapshot.counts, seed.counts);
  time = '2027-01-02T17:00:00.000Z';
  assert.deepEqual(await success(await request(invite('worker-002'), 'POST', 'manager')), first);
  assert.deepEqual(await success(await request(shift)), first.snapshot);
});

test('interleaved invitations produce one mutation per worker; reset restores the seed', async (t) => {
  const request = await fixture(t);
  const seed = await success<Snapshot>(await request(shift));
  const ids = ['worker-002', 'worker-003', 'worker-002', 'worker-003', 'worker-003', 'worker-002'];
  const receipts = await Promise.all(ids.map(async id => {
    const result = await success<InviteResponse>(await request(invite(id), 'POST', 'manager'));
    return result.invitation;
  }));
  const after = await success<Snapshot>(await request(shift));
  assert.equal(after.revision, seed.revision + 2);
  assert.deepEqual(after.counts, seed.counts);
  ids.forEach((id, index) => {
    const worker = after.workers.find(w => w.id === id);
    assert.ok(worker);
    assert.equal(worker.participation, 'invited');
    assert.deepEqual(receipts[index], { shiftId: seed.shift.id, workerId: id, invitedAt: worker.invitedAt });
  });
  const restored = await success<Snapshot>(await request(reset, 'POST', 'manager'));
  assert.deepEqual(restored, { ...seed, revision: after.revision + 1 });
  assert.deepEqual(await success(await request(shift)), restored);
});

test('a restart preserves committed invitations and accepts their retries', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'staffing-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'test.sqlite');
  const first = await start(file);
  let original: InviteResponse;
  try {
    original = await success<InviteResponse>(await first.request(invite('worker-003'), 'POST', 'manager'));
  } finally {
    await first.close();
  }

  const reopened = await start(file);
  try {
    assert.deepEqual(await success(await reopened.request(shift)), original.snapshot);
    assert.deepEqual(await success(await reopened.request(invite('worker-003'), 'POST', 'manager')), original);
  } finally {
    await reopened.close();
  }
});
