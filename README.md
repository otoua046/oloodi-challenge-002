# Tideway Staffing · Coding Challenge 002 · Staffing assistant

Build a staffing assistant that works with the dashboard in this repository. The starter includes the dashboard, a seeded shift, and an API for reading the roster and inviting a worker. Follow the Challenge 002 brief for the full assignment.

## Run the demo

From the repository root, run:

```sh
docker compose up --build
```

Open **http://127.0.0.1:3000**. The first start seeds the database. Later starts reuse it. To restore the seed while the app is running, use `docker compose exec staffing npm run reset`. To stop, use `docker compose down`.

For local development, use **Node 24.12 or later** and npm:

```sh
npm ci
npm start
```

`npm start` builds React and starts the API on the same port. Restart it after editing the source. Run `npm run reset` in a second terminal to restore the seed. The default database is `data/staffing.sqlite`. Override `PORT`, `HOST`, or `DATABASE_PATH` when starting the server. Set `APP_URL` on the reset command if the address changes.

## The shift

**Evening event crew** (`shift-001`) runs Tuesday, November 24, 2026, from 5 to 10 p.m. Toronto time at Harbor Hall, East Entrance. The fixed date keeps every demo reproducible.

| Worker | Stable ID | Initial participation | Initial attendance |
| --- | --- | --- | --- |
| Jordan Lee | `worker-001` | Accepted | Checked in at 4:55 p.m. |
| Alex Chen | `worker-002` | Uninvited | Not started |
| Alex Rivera | `worker-003` | Uninvited | Not started |

The shift requires **3** people. Initially **1** place is filled, **2** remain, **1** worker is checked in and **0** have checked out. Both Alexes are eligible for invitation. A first name alone is ambiguous. Inviting either worker changes participation to Invited and records the invitation time. Only acceptance fills a place. The starter exposes invitation as its only staffing mutation.

## Roster and activity

Overview shows each worker’s latest status. Attendance takes precedence once someone has checked in or out. The API retains the separate participation and attendance fields and the stable IDs. Portraits are fictional and bundled with the app.

Activity shows the shift’s events newest first, grouped by Toronto date. The initial timeline contains Jordan’s invitation, acceptance, and check-in. Maya Patel is the named demo Manager for both dashboard and API invitations. An invitation and its activity entry commit together. A rejected or repeated invitation adds no entry. Reset restores the roster and adds an event to the existing timeline. When upgrading an existing database, older non-seed invitations are attributed to the demo manager role, the identity the old app recorded.

## Integration contract

The local role selector starts on Manager. API callers select a demo identity using `X-Demo-Role: manager` or `X-Demo-Role: viewer`. Omitting the header selects Viewer. The header is a public local fixture. An integration should pass its current caller’s role from application state. The server checks permission on every write.

| Method | Path | Success response |
| --- | --- | --- |
| GET | `/api/shifts/:shiftId` | Current dashboard snapshot |
| POST | `/api/shifts/:shiftId/workers/:workerId/invite` | Manager only. Invitation receipt and committed snapshot |
| GET | `/api/shifts/:shiftId/events` | SSE stream of named `snapshot` events |
| POST | `/api/demo/reset` | Manager only. Restores the seed and returns its new snapshot |

All JSON endpoints return HTTP 200 on success. Both POST endpoints take an empty body. The stable IDs in the path identify the target.

```sh
BASE=http://127.0.0.1:3000
SHIFT="$BASE/api/shifts/shift-001"
curl -sS "$SHIFT"
curl -i -X POST -H 'X-Demo-Role: viewer' "$SHIFT/workers/worker-002/invite"
curl -sS -X POST -H 'X-Demo-Role: manager' "$SHIFT/workers/worker-002/invite"
curl -N "$SHIFT/events"
```

The second command returns 403. The third invites Alex Chen. Repeat it to get the same `invitation` object, including its original UTC timestamp. A repeat does not increment the revision or publish another update. Its accompanying `snapshot` is current and may include intervening changes to other workers.

The snapshot contains `shift` (ID, title, location, start/end instants, time zone, required workers), `workers` (stable IDs, full names, participation, attendance and nullable timestamps), `counts`, the ordered `activity` array, and a numeric `revision`. The invite response wraps it as `{ invitation: { shiftId, workerId, invitedAt }, snapshot }`. See [shared/types.ts](shared/types.ts) for the exact field names, types and status values.

Errors have the shape `{"error":{"code":"FORBIDDEN","message":"This action requires the Manager role."}}`.

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `INVALID_ROLE` | Unsupported demo role |
| 403 | `FORBIDDEN` | Viewer attempts an invitation or reset |
| 404 | `SHIFT_NOT_FOUND`, `WORKER_NOT_FOUND`, `NOT_FOUND` | Unknown shift, worker or route |
| 405 | `METHOD_NOT_ALLOWED` | Known endpoint, wrong HTTP method |
| 409 | `INVALID_TRANSITION` | A manager tries to invite the already accepted worker |

## See a change on an open dashboard

1. Open the dashboard and switch to Viewer. Leave it open with the connection indicator showing **Live**.
2. Run the Manager invitation above in a terminal. Watch Alex Chen change to **Invited** in the Viewer tab. The staffing counts stay at 1 filled and 2 open.
3. Repeat the command and compare the invitation timestamps. Switch to Manager and use **Invite** beside Alex Rivera to try the same write from the UI.
4. Reset from the terminal. Both Alexes return to Uninvited on the open page.

## Implementation and checks

`server/staffing.ts` owns the rules and counts. `server/database.ts` checks and records an invitation within a SQLite write transaction. Every actual change increments a persistent revision. `server/app.ts` publishes through `server/live.ts` after commit. On a new connection the server registers the stream and sends a current snapshot before it can handle another write. This closes the gap between loading the page and receiving live updates.

The dashboard applies the confirmed POST response immediately. Its EventSource reconnects automatically and receives the latest complete snapshot, including changes made during an outage. The client checks revisions so a late response cannot replace newer data. Live delivery assumes one server process per database and writes through its API.

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

On Linux CI, install browser system dependencies with `npx playwright install --with-deps chromium`. To use an existing Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path.

The API tests use isolated SQLite databases and a controllable clock. They cover permissions, invalid transitions, repeat and concurrent writes, counts, reset, and persistence after restart. The three Playwright tests run isolated app instances. They check an API invitation reaching an open Viewer tab, a manual invite while the stream is down, and recovery after a missed update. The recovery test closes the real connection, holds the reconnect request, writes from an independent API client, checks that the row is still stale, and releases the request. It checks that the original browser document stays mounted.
