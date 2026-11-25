import type { IncomingMessage, ServerResponse } from 'node:http'
import { workerActions, type WorkerAction } from '../../shared/assignment-rules.ts'
import type { Role } from '../../shared/api-types.ts'
import type { openStaffing } from '../workflows/staffing.ts'
import type { liveDashboard } from './live.ts'
import { ApiError, json } from './responses.ts'

export interface RouteContext {
  request: IncomingMessage
  response: ServerResponse
  role: Role
  // The path segments the route's pattern captured, in order.
  params: string[]
  staffing: ReturnType<typeof openStaffing>
  live: ReturnType<typeof liveDashboard>
}

export interface Route {
  method: 'GET' | 'POST'
  path: RegExp
  // May be async, for example to call a model. app.ts awaits it, so a thrown error still becomes a JSON 500.
  handle(context: RouteContext): void | Promise<void>
}

const id = '([^/]+)'
const action = '(' + Object.keys(workerActions).join('|') + ')'

// Every API endpoint. A handler reads the request, calls one workflow, publishes changes, and responds.
// To add an endpoint, add an entry here and put its logic in a workflow.
export const routes: Route[] = [
  {
    method: 'GET',
    path: /^\/api\/shifts$/,
    handle: ({ response, staffing }) => json(response, 200, { shifts: staffing.shifts() }),
  },
  {
    method: 'GET',
    path: new RegExp(`^/api/shifts/${id}$`),
    handle: ({ response, staffing, params: [shiftId] }) => json(response, 200, staffing.snapshot(shiftId!)),
  },
  {
    method: 'GET',
    path: new RegExp(`^/api/shifts/${id}/events$`),
    // Reading and registering the stream happen synchronously, before another request can commit.
    handle: ({ response, staffing, live, params: [shiftId] }) => live.subscribe(response, staffing.snapshot(shiftId!)),
  },
  {
    method: 'POST',
    path: new RegExp(`^/api/shifts/${id}/workers/${id}/invite$`),
    handle({ request, response, role, staffing, live, params: [shiftId, workerId] }) {
      const key = request.headers['idempotency-key']
      if (Array.isArray(key)) throw new ApiError(400, 'INVALID_REQUEST_KEY', 'Supply one Idempotency-Key.')
      const { changed, result } = staffing.invite(role, shiftId!, workerId!, key)
      if (changed) live.publish(result.snapshot)
      json(response, 200, result)
    },
  },
  {
    method: 'POST',
    path: new RegExp(`^/api/shifts/${id}/workers/${id}/${action}$`),
    handle({ request, response, role, staffing, live, params: [shiftId, workerId, name] }) {
      const actor = request.headers['x-demo-worker-id']
      const key = request.headers['idempotency-key']
      const result = staffing.workerAction({
        role,
        actorId: typeof actor === 'string' ? actor : undefined,
        shiftId: shiftId!,
        workerId: workerId!,
        action: name as WorkerAction,
        key: typeof key === 'string' ? key : undefined,
      })
      if (result.changed) live.publish(result.snapshot)
      json(response, 200, result)
    },
  },
  {
    method: 'POST',
    path: /^\/api\/demo\/reset$/,
    handle({ response, role, staffing, live }) {
      const snapshot = staffing.reset(role)
      // A reset changes every shift. These reads run before any other request can commit.
      for (const shiftId of live.shifts()) live.publish(staffing.snapshot(shiftId))
      json(response, 200, snapshot)
    },
  },
]
