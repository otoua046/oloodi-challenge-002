import { useState } from 'react'
import type { Role, Snapshot, Worker } from '../shared/types'
import { Icon, VenuePlan, type IconName } from './Icons'
import { Portrait } from './Portrait'
import { WorkerStatus } from './WorkerStatus'

function formatDate(date: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(date))
}

export function ShiftHeader({ shift }: { shift: Snapshot['shift'] }) {
  const { startsAt, endsAt, timeZone } = shift
  const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } as const
  const day = formatDate(startsAt, timeZone, dateOptions)
  const lastDay = formatDate(endsAt, timeZone, dateOptions)
  const time = { hour: 'numeric', minute: '2-digit' } as const
  return (
    <section className="shift-header" aria-labelledby="shift-title">
      <VenuePlan />
      <div className="shift-content">
        <div className="eyebrow">
          <span />
          Shift overview
        </div>
        <h1 id="shift-title">{shift.title}</h1>
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
          <span>
            <Icon name="pin" />
            {shift.location}
          </span>
        </div>
      </div>
    </section>
  )
}

export function Metrics({ snapshot }: { snapshot: Snapshot }) {
  const { counts, shift } = snapshot
  const metrics: { label: string; value: number; icon: IconName; tone: string }[] = [
    { label: 'Filled spots', value: counts.filled, icon: 'people', tone: 'purple' },
    { label: 'Open spots', value: counts.remaining, icon: 'open', tone: 'amber' },
    { label: 'Checked in', value: counts.checkedIn, icon: 'checkIn', tone: 'green' },
    { label: 'Checked out', value: counts.checkedOut, icon: 'checkOut', tone: 'slate' },
  ]
  return (
    <dl className="metrics" aria-label="Shift staffing counts">
      {metrics.map((metric, index) => (
        <div className="metric" key={metric.label}>
          <dt>
            <span className={'metric-icon ' + metric.tone}>
              <Icon name={metric.icon} />
            </span>
            {metric.label}
          </dt>
          <dd>
            {metric.value}
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
            <th scope="col" className="action-cell">
              Action
            </th>
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
                {[['In', worker.checkedInAt], ['Out', worker.checkedOutAt]].map(([label, at]) => at &&
                  <small className="attendance-time" key={label}>{label} <time dateTime={at}>
                    {formatDate(at, snapshot.shift.timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
                  </time></small>
                )}
              </td>
              <td className="action-cell">
                {role === 'manager' && worker.participation === 'uninvited' ? (
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
              </td>
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
