import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { workerActions, type WorkerAction } from '../shared/worker-actions.ts'
import type { Role } from '../shared/types.ts'
import { openStaffing } from './database.ts'
import { liveDashboard } from './live.ts'
import { ApiError } from './staffing.ts'

interface AppOptions {
  databasePath: string
  clientDir?: string
  now?: () => string
}

function roleFor(request: IncomingMessage): Role {
  const role = request.headers['x-demo-role'] ?? 'viewer'
  if (role === 'viewer' || role === 'manager' || role === 'worker') return role
  throw new ApiError(400, 'INVALID_ROLE', 'X-Demo-Role must be viewer, manager, or worker.')
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

export function createApp({ databasePath, clientDir = 'dist/client', now }: AppOptions) {
  const staffing = openStaffing(databasePath, now)
  const live = liveDashboard()

  const server = createServer(async (request, response) => {
    try {
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
          const { changed, result } = staffing.invite(role, invite[1]!, invite[2]!)
          if (changed) live.publish(result.snapshot)
          json(response, 200, result)
          return
        }
        const action = /^\/api\/shifts\/([^/]+)\/workers\/([^/]+)\/([^/]+)$/.exec(path)
        if (action && Object.hasOwn(workerActions, action[3]!)) {
          requireMethod(request.method, 'POST', response)
          const actor = request.headers['x-demo-worker-id']
          const key = request.headers['idempotency-key']
          const result = staffing.workerAction(role, typeof actor === 'string' ? actor : undefined, action[1]!, action[2]!,
            action[3] as WorkerAction, typeof key === 'string' ? key : undefined)
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
      if (error instanceof ApiError) {
        json(response, error.status, { error: { code: error.code, message: error.message } })
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
        server.close(error => error ? reject(error) : done())
        server.closeAllConnections()
      })
    }
    staffing.close()
  }

  return { server, close }
}
