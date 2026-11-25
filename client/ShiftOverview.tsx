import { useState } from 'react'
import type { Role, Snapshot, Worker } from '../shared/types'
import { Icon, VenuePlan } from './Icons'
import { Portrait } from './Portrait'
import { WorkerStatus, statusLabels, workerState } from './WorkerStatus'

function formatDate(date: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(date))
}

export function ShiftHeader({ snapshot, connection, detailed }: { snapshot: Snapshot; connection: string; detailed: boolean }) {
  const { shift, workers } = snapshot
  const { startsAt, endsAt, timeZone } = shift
  const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } as const
  const day = formatDate(startsAt, timeZone, dateOptions)
  const lastDay = formatDate(endsAt, timeZone, dateOptions)
  const time = { hour: 'numeric', minute: '2-digit' } as const
  // Accepted workers hold a place throughout attendance. The rest of the places are open.
  const crew = workers.filter(worker => worker.participation === 'accepted')
  return (
    <section className="shift-header" aria-labelledby="shift-title">
      <VenuePlan />
      <div className="wrap shift-content">
        <div className="shift-top">
          <div className="shift-details">
            <span>
              <Icon name="calendar" />
              {day}
              {day !== lastDay && ' – ' + lastDay}
            </span>
            <span>
              <Icon name="clock" />
              {formatDate(startsAt, timeZone, time)} –{' '}
              {formatDate(endsAt, timeZone, { ...time, timeZoneName: 'short' })}
            </span>
          </div>
          <span role="status" aria-label={'Live updates: ' + connection} className={'connection ' + connection.toLowerCase()}>
            <i />
            {connection}
          </span>
        </div>
        <div className="shift-main">
          <div>
            <h1 id="shift-title">{shift.title}</h1>
            <p className="shift-place">
              <Icon name="pin" />
              {shift.location}
            </p>
          </div>
          {detailed && <ul className="crew" aria-label="Crew places">
            {Array.from({ length: shift.requiredWorkers }, (_, index) => {
              const worker = crew[index]
              return worker
                ? <li key={worker.id} className={worker.attendance} style={{ animationDelay: 120 + index * 90 + 'ms' }}><Portrait id={worker.id} name={worker.name} />{worker.name}<small>{statusLabels[workerState(worker)]}</small></li>
                : <li key={index} className="open" style={{ animationDelay: 120 + index * 90 + 'ms' }}><span className="avatar"><Icon name="open" size={22} /></span>Open</li>
            })}
          </ul>}
        </div>
        {detailed && <Metrics snapshot={snapshot} />}
      </div>
    </section>
  )
}

export function Metrics({ snapshot }: { snapshot: Snapshot }) {
  const { counts, shift } = snapshot
  const metrics = [
    ['Filled spots', counts.filled], ['Open spots', counts.remaining],
    ['Checked in', counts.checkedIn], ['Checked out', counts.checkedOut],
  ] as const
  return (
    <dl className="metrics" aria-label="Shift staffing counts">
      {metrics.map(([label, value], index) => (
        <div className="metric" key={label}>
          <dt>{label}</dt>
          <dd>
            {/* Keyed by value so a changed count replays its entrance. */}
            <span key={value} className="count">{value}</span>
            {index === 0 && <small> / {shift.requiredWorkers}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Roster({
  snapshot,
  role,
  invite,
}: {
  snapshot: Snapshot
  role: Role
  invite: (id: string, role: Role) => Promise<void>
}) {
  const [pending, setPending] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)
  async function sendInvite(worker: Worker) {
    setPending((ids) => [...ids, worker.id])
    setFeedback(null)
    try {
      await invite(worker.id, role)
      setFeedback({ message: 'Invitation sent to ' + worker.name + '.' })
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'Could not reach the server. You can safely retry this invitation.'
          : error instanceof Error
            ? error.message
            : 'Invitation could not be confirmed.'
      setFeedback({ message, error: true })
    } finally {
      setPending((ids) => ids.filter((id) => id !== worker.id))
    }
  }
  const canInvite = role === 'manager'
  return (
    <section className="panel roster" aria-labelledby="roster-title">
      <div className="panel-heading">
        <h2 id="roster-title">Worker roster</h2>
        <span className="worker-total">
          <Icon name="people" size={15} />
          {snapshot.workers.length} workers
        </span>
      </div>
      {role === 'viewer' && (
        <p className="viewer-note">Viewer access is read-only. Switch to Manager to invite workers.</p>
      )}
      <table>
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Status</th>
            {canInvite && <th scope="col" className="action-cell">Action</th>}
          </tr>
        </thead>
        <tbody>
          {snapshot.workers.map((worker) => (
            <tr key={worker.id}>
              <th scope="row" className="identity-cell">
                <div className="identity">
                  <Portrait id={worker.id} name={worker.name} />
                  <span className="worker-name">{worker.name}</span>
                </div>
              </th>
              <td>
                <WorkerStatus worker={worker} />
                {[['Invited', worker.participation === 'invited' ? worker.invitedAt : null], ['In', worker.checkedInAt], ['Out', worker.checkedOutAt]].map(([label, at]) => at &&
                  <small className="attendance-time" key={label}>{label} <time dateTime={at}>
                    {formatDate(at, snapshot.shift.timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                  </time></small>
                )}
              </td>
              {canInvite && <td className="action-cell">
                {worker.participation === 'uninvited' ? (
                  <button
                    type="button"
                    className="invite"
                    disabled={pending.includes(worker.id)}
                    aria-label={'Invite ' + worker.name}
                    onClick={() => void sendInvite(worker)}
                  >
                    <Icon name="invite" size={14} />
                    {pending.includes(worker.id) ? 'Sending…' : 'Invite'}
                  </button>
                ) : (
                  <span className="no-action" aria-label="No available action">
                    —
                  </span>
                )}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-live="polite" aria-atomic="true">
        {feedback && (
          <p className={'feedback' + (feedback.error ? ' error' : '')}>{feedback.message}</p>
        )}
      </div>
    </section>
  )
}
