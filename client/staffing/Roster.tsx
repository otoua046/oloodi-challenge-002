import { useState } from 'react'
import type { Role, Snapshot, Worker } from '../../shared/api-types'
import { Icon } from '../ui/Icons'
import { Portrait } from '../ui/Portrait'
import { formatDate } from './format'
import { WorkerStatus } from './WorkerStatus'

export function Roster({
  snapshot,
  role,
  invite,
  reset,
}: {
  snapshot: Snapshot
  role: Role
  invite: (id: string, role: Role) => Promise<void>
  reset: (role: Role) => Promise<void>
}) {
  const [pending, setPending] = useState<string[]>([])
  const [resetting, setResetting] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)
  async function sendInvite(worker: Worker) {
    setPending(ids => [...ids, worker.id])
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
      setPending(ids => ids.filter(id => id !== worker.id))
    }
  }
  async function resetDemo() {
    const confirmed = window.confirm(
      'Reset the demo for everyone viewing it? Every worker returns to the starting roster. The activity history is kept.',
    )
    if (!confirmed) return
    setResetting(true)
    setFeedback(null)
    try {
      await reset(role)
      setFeedback({ message: 'The demo is back to the starting roster.' })
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'Could not reach the server. Try the reset again.'
          : error instanceof Error
            ? error.message
            : 'The reset could not be confirmed.'
      setFeedback({ message, error: true })
    } finally {
      setResetting(false)
    }
  }
  const canInvite = role === 'manager'
  const assignments = new Map(snapshot.assignments.map(assignment => [assignment.workerId, assignment]))
  return (
    <section className="panel roster" aria-labelledby="roster-title">
      <div className="panel-heading">
        <h2 id="roster-title">Worker roster</h2>
        <div className="panel-actions">
          <span className="worker-total">
            <Icon name="people" size={15} />
            {snapshot.workers.length} workers
          </span>
          {canInvite && (
            <button type="button" className="reset-demo" disabled={resetting} onClick={() => void resetDemo()}>
              <Icon name="reset" size={14} />
              {resetting ? 'Resetting…' : 'Reset demo'}
            </button>
          )}
        </div>
      </div>
      {role === 'viewer' && (
        <p className="viewer-note">Viewer access is read-only. Switch to Manager to invite workers.</p>
      )}
      <table>
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Status</th>
            {canInvite && (
              <th scope="col" className="action-cell">
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {snapshot.workers.map(worker => {
            const assignment = assignments.get(worker.id)
            return (
              <tr key={worker.id}>
                <th scope="row" className="identity-cell">
                  <div className="identity">
                    <Portrait id={worker.id} name={worker.name} />
                    <span className="worker-name">{worker.name}</span>
                  </div>
                </th>
                <td>
                  <WorkerStatus assignment={assignment} />
                  {[
                    ['Invited', assignment?.participation === 'invited' ? assignment.invitedAt : null],
                    ['In', assignment?.checkedInAt],
                    ['Out', assignment?.checkedOutAt],
                  ].map(
                    ([label, at]) =>
                      at && (
                        <small className="attendance-time" key={label}>
                          {label}{' '}
                          <time dateTime={at}>
                            {formatDate(at, snapshot.shift.timeZone, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              timeZoneName: 'short',
                            })}
                          </time>
                        </small>
                      ),
                  )}
                </td>
                {canInvite && (
                  <td className="action-cell">
                    {!assignment ? (
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
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div aria-live="polite" aria-atomic="true">
        {feedback && <p className={'feedback' + (feedback.error ? ' error' : '')}>{feedback.message}</p>}
      </div>
    </section>
  )
}
