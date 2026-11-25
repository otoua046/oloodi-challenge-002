import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import type { Role } from '../shared/types.ts'
import { openStaffing } from './staffing-service.ts'
import { liveDashboard } from './live.ts'
import { StaffingError, type StaffingErrorCode } from './staffing.ts'

interface AppOptions {
  databasePath: string
  clientDir?: string
  now?: () => string
  // A shared password for a public preview. Local runs leave it unset and stay open.
  previewPassword?: string
}

// Errors that belong to HTTP itself: headers, methods, routes and files.
class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const statusForRule: Record<StaffingErrorCode, number> = {
  FORBIDDEN: 403,
  SHIFT_NOT_FOUND: 404,
  WORKER_NOT_FOUND: 404,
  INVALID_REQUEST_KEY: 400,
  REQUEST_KEY_REUSED: 409,
  INVALID_TRANSITION: 409,
}

function roleFor(request: IncomingMessage): Role {
  const role = request.headers['x-demo-role'] ?? 'viewer'
  if (role === 'viewer' || role === 'manager' || role === 'worker') return role
  throw new ApiError(400, 'INVALID_ROLE', 'X-Demo-Role must be viewer, manager, or worker.')
}

// Any user name is accepted. Comparing digests keeps the check constant-time whatever the input length.
function requirePreviewPassword(request: IncomingMessage, response: ServerResponse, password: string) {
  const [scheme, encoded] = (request.headers.authorization ?? '').split(' ')
  const supplied =
    scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(supplied), digest(password))) {
    response.setHeader('WWW-Authenticate', 'Basic realm="Tideway preview", charset="UTF-8"')
    throw new ApiError(401, 'UNAUTHORIZED', 'Enter the preview password.')
  }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function requireMethod(method: string | undefined, expected: string, response: ServerResponse) {
  if (method !== expected) {
    response.setHeader('Allow', expected)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${expected} for this endpoint.`)
  }
}

const mediaTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

export function createApp({ databasePath, clientDir = 'dist/client', now, previewPassword }: AppOptions) {
  const staffing = openStaffing(databasePath, now)
  const live = liveDashboard()

  const server = createServer(async (request, response) => {
    try {
      if (previewPassword) requirePreviewPassword(request, response, previewPassword)
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path.startsWith('/api/')) {
        const role = roleFor(request)
        const match = /^\/api\/shifts\/([^/]+)(\/events)?$/.exec(path)
        if (match) {
          requireMethod(request.method, 'GET', response)
          // Reading and registering the stream happen synchronously, before another request can commit.
          const snapshot = staffing.snapshot(match[1]!)
          if (match[2]) live.subscribe(response, snapshot)
          else json(response, 200, snapshot)
          return
        }
        const invite = /^\/api\/shifts\/([^/]+)\/workers\/([^/]+)\/invite$/.exec(path)
        if (invite) {
          requireMethod(request.method, 'POST', response)
          const key = request.headers['idempotency-key']
          if (Array.isArray(key)) throw new ApiError(400, 'INVALID_REQUEST_KEY', 'Supply one Idempotency-Key.')
          const { changed, result } = staffing.invite(role, invite[1]!, invite[2]!, key)
          if (changed) live.publish(result.snapshot)
          json(response, 200, result)
          return
        }
        const action = /^\/api\/shifts\/([^/]+)\/workers\/([^/]+)\/([^/]+)$/.exec(path)
        if (action && Object.hasOwn(workerActions, action[3]!)) {
          requireMethod(request.method, 'POST', response)
          const actor = request.headers['x-demo-worker-id']
          const key = request.headers['idempotency-key']
          const result = staffing.workerAction({
            role,
            actorId: typeof actor === 'string' ? actor : undefined,
            shiftId: action[1]!,
            workerId: action[2]!,
            action: action[3] as WorkerAction,
            key: typeof key === 'string' ? key : undefined,
          })
          if (result.changed) live.publish(result.snapshot)
          json(response, 200, result)
          return
        }
        if (path === '/api/demo/reset') {
          requireMethod(request.method, 'POST', response)
          const snapshot = staffing.reset(role)
          live.publish(snapshot)
          json(response, 200, snapshot)
          return
        }
      } else if (path === '/' || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(path) || path === '/favicon.svg') {
        requireMethod(request.method, 'GET', response)
        const file = path === '/' ? 'index.html' : path.slice(1)
        let bytes: Buffer
        try {
          bytes = await readFile(resolve(clientDir, file))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          if (path === '/') throw new ApiError(503, 'BUILD_REQUIRED', 'Build the dashboard with npm run build.')
          throw new ApiError(404, 'NOT_FOUND', 'File not found.')
        }
        response.writeHead(200, { 'Content-Type': mediaTypes[extname(file)] ?? 'application/octet-stream' })
        response.end(bytes)
        return
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.')
    } catch (error) {
      if (error instanceof ApiError || error instanceof StaffingError) {
        const status = error instanceof ApiError ? error.status : statusForRule[error.code]
        json(response, status, { error: { code: error.code, message: error.message } })
      } else {
        console.error(error)
        json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } })
      }
    }
  })

  async function close() {
    live.close()
    if (server.listening) {
      await new Promise<void>((done, reject) => {
        server.close(error => (error ? reject(error) : done()))
        server.closeAllConnections()
      })
    }
    staffing.close()
  }

  return { server, close }
}
