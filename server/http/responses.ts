import type { ServerResponse } from 'node:http'
import type { StaffingErrorCode } from '../domain/rules.ts'

// Errors that belong to HTTP itself: headers, methods, routes and files.
export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// The HTTP status for each domain rule violation. A new error code needs an entry here.
export const statusForRule: Record<StaffingErrorCode, number> = {
  FORBIDDEN: 403,
  SHIFT_NOT_FOUND: 404,
  WORKER_NOT_FOUND: 404,
  INVALID_REQUEST_KEY: 400,
  REQUEST_KEY_REUSED: 409,
  INVALID_TRANSITION: 409,
}

export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
