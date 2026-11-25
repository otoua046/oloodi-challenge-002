import type { Worker } from '../shared/types'

const participationLabels = { uninvited: 'Uninvited', invited: 'Invited', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled' } as const

export function WorkerStatus({ worker }: { worker: Worker }) {
  const state = worker.attendance === 'not_started' ? worker.participation : worker.attendance
  const labels = { ...participationLabels, checked_in: 'Checked in', checked_out: 'Checked out' }
  return <span className={'badge ' + state}><i />{labels[state]}</span>
}
