import { useState } from 'react'
import type { Worker } from '../shared/types'

export const statusLabels = {
  uninvited: 'Uninvited', invited: 'Invited', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled',
  checked_in: 'Checked in', checked_out: 'Checked out',
} as const
export type WorkerState = keyof typeof statusLabels

// Attendance takes precedence once someone has checked in or out.
export function workerState(worker: Worker): WorkerState {
  return worker.attendance === 'not_started' ? worker.participation : worker.attendance
}

export function WorkerStatus({ worker }: { worker: Worker }) {
  const state = workerState(worker)
  // The badge remounts on every later change so its highlight replays. The first render stays quiet.
  const [initial] = useState(state)
  const [changed, setChanged] = useState(false)
  if (!changed && state !== initial) setChanged(true)
  return <span key={state} className={'badge ' + state + (changed ? ' changed' : '')}><i />{statusLabels[state]}</span>
}
