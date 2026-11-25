import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Role, Snapshot, Worker } from '../shared/types'
import { Icon, VenuePlan } from './Icons'
import { Activity } from './Activity'
import { Portrait } from './Portrait'
import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions'
import { demoManager } from '../shared/types'
import { useShift } from './useShift'
import './style.css'

function formatDate(date: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(date))
}

function ShiftHeader({ snapshot, connection, detailed }: { snapshot: Snapshot; connection: string; detailed: boolean }) {
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
                ? <li key={worker.id} className={worker.attendance} style={{ animationDelay: 120 + index * 90 + 'ms' }}><Portrait worker={worker} />{worker.name}<small>{statusLabels[workerState(worker)]}</small></li>
                : <li key={index} className="open" style={{ animationDelay: 120 + index * 90 + 'ms' }}><span className="avatar"><Icon name="open" size={22} /></span>Open</li>
            })}
          </ul>}
        </div>
        {detailed && <Metrics snapshot={snapshot} />}
      </div>
    </section>
  )
}

function Metrics({ snapshot }: { snapshot: Snapshot }) {
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

const statusLabels = {
  uninvited: 'Uninvited', invited: 'Invited', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled',
  checked_in: 'Checked in', checked_out: 'Checked out',
} as const
type WorkerState = keyof typeof statusLabels

// Attendance takes precedence once someone has checked in or out.
function workerState(worker: Worker): WorkerState {
  return worker.attendance === 'not_started' ? worker.participation : worker.attendance
}

function statusTime(worker: Worker) {
  if (worker.attendance === 'checked_out') return worker.checkedOutAt
  if (worker.attendance === 'checked_in') return worker.checkedInAt
  return worker.participation === 'invited' ? worker.invitedAt : null
}

function Status({ worker }: { worker: Worker }) {
  const state = workerState(worker)
  // The badge remounts on every later change so its highlight replays. The first render stays quiet.
  const [initial] = useState(state)
  const [changed, setChanged] = useState(false)
  if (!changed && state !== initial) setChanged(true)
  return <span key={state} className={'badge ' + state + (changed ? ' changed' : '')}><i />{statusLabels[state]}</span>
}

function Roster({
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
  const timeFormat = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } as const
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
          {snapshot.workers.map((worker) => {
            const at = statusTime(worker)
            return <tr key={worker.id}>
              <th scope="row" className="identity-cell">
                <div className="identity">
                  <Portrait worker={worker} />
                  <span className="worker-name">{worker.name}</span>
                </div>
              </th>
              <td>
                <Status worker={worker} />
                {at && <time className="status-time" dateTime={at}>{formatDate(at, snapshot.shift.timeZone, timeFormat)}</time>}
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
          })}
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

const steps = ['Invite', 'Accept', 'Check in', 'Check out']
const completedSteps: Record<WorkerState, number> = {
  uninvited: 0, invited: 1, declined: 1, cancelled: 1, accepted: 2, checked_in: 3, checked_out: 4,
}
const guidance: Record<WorkerState, string> = {
  uninvited: 'You haven’t received an invitation for this shift.',
  invited: 'You’re invited. Accept to take a spot on this shift.',
  accepted: 'You’re confirmed. Check in when you arrive.',
  declined: 'You declined this invitation.',
  cancelled: 'You cancelled your spot. You can accept again.',
  checked_in: 'You’re checked in. Check-out is final.',
  checked_out: 'Shift complete. You’re checked out.',
}

function WorkerShift({ worker, snapshot, respond }: {
  worker: Worker
  snapshot: Snapshot
  respond: ReturnType<typeof useShift>['respond']
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const actions = availableActions(worker)
  const state = workerState(worker)
  const done = completedSteps[state]
  async function perform(action: WorkerAction) {
    setPending(true)
    setError('')
    try {
      await respond(worker.id, action, snapshot.revision)
    } catch (cause) {
      setError(cause instanceof TypeError ? 'Could not confirm the change. Check your status and retry.' :
        cause instanceof Error ? cause.message : 'Could not confirm the change.')
    } finally {
      setPending(false)
    }
  }
  return <section className="panel worker-shift" aria-label="My assignment">
    <div className="panel-heading">
      <div className="identity"><Portrait worker={worker} /><h2>{worker.name}</h2></div>
      <div aria-live="polite"><Status worker={worker} /></div>
    </div>
    <ol className="steps" aria-label="Shift progress">
      {steps.map((step, index) => (
        <li key={step} className={index < done ? 'done' : undefined} aria-current={index === done && actions.length > 0 ? 'step' : undefined}>
          {index < done && <Icon name="check" size={13} />}
          {step}
          {index < done && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
    <p className="viewer-note">{guidance[state]}</p>
    {actions.length > 0 && <div className="worker-actions">
      {actions.map(action => <button key={action} disabled={pending} className="invite" onClick={() => void perform(action)}>
        {workerActions[action].label}
      </button>)}
    </div>}
    {error && <p role="alert" className="feedback error">{error}</p>}
  </section>
}

function App() {
  const { snapshot, connection, loadError, invite, respond } = useShift()
  const [role, setRole] = useState<Role>(() => {
    const saved = sessionStorage.getItem('demo-role')
    return saved === 'viewer' || saved === 'worker' ? saved : 'manager'
  })
  const [workerId, setWorkerId] = useState(() => sessionStorage.getItem('demo-worker') ?? '')
  const worker = snapshot?.workers.find(person => person.id === workerId) ?? snapshot?.workers[0]
  function selectRole(next: Role) {
    sessionStorage.setItem('demo-role', next)
    setRole(next)
    if (next === 'worker') window.location.hash = 'overview'
  }

  const [activityOpen, setActivityOpen] = useState(() => window.location.hash === '#activity')
  useEffect(() => {
    const navigate = () => setActivityOpen(window.location.hash === '#activity')
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="#overview" aria-label="Tideway Staffing overview">
            <svg viewBox="0 0 32 32" width="38" height="38" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#d9eba8" />
              <path d="M5 12q5-5 11 0t11 0M5 17q5-5 11 0t11 0M5 22q5-5 11 0t11 0" fill="none" stroke="#12574f" strokeWidth="2.3" />
            </svg>
            <span><b>Tideway</b><small>Staffing</small></span>
          </a>
          <nav aria-label="Shift navigation">
            <a href="#overview" aria-current={!activityOpen ? 'page' : undefined}>Overview</a>
            <a href="#activity" aria-current={activityOpen ? 'page' : undefined}>Activity</a>
          </nav>
          <div className="role-control">
            <label htmlFor="demo-role" className="sr-only">Demo role</label>
            <span className="acting-as">Acting as</span>
            {role === 'manager' && <span className="manager-name">{demoManager}</span>}
            {role === 'worker' && snapshot && worker && <div className="role-select">
              <Portrait worker={worker} />
              <select aria-label="Select worker" value={worker.id} onChange={event => {
                sessionStorage.setItem('demo-worker', event.target.value)
                setWorkerId(event.target.value)
              }}>
                {snapshot.workers.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
              </select>
              <Icon name="down" size={13} />
            </div>}
            <div className="role-select">
              <Icon name="shield" size={15} />
              <select
                id="demo-role"
                value={role}
                onChange={(event) => selectRole(event.target.value as Role)}
              >
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
                <option value="worker">Worker</option>
              </select>
              <Icon name="down" size={13} />
            </div>
          </div>
        </div>
      </header>
      <main>
        {snapshot ? (
          <>
            <ShiftHeader snapshot={snapshot} connection={connection} detailed={!activityOpen && role !== 'worker'} />
            <div className="wrap content">
              {activityOpen ? <Activity events={role === 'worker' ? snapshot.activity.filter(event => event.workerId === worker?.id) : snapshot.activity} shift={snapshot.shift} /> : role === 'worker' && worker ? (
                <WorkerShift key={worker.id} worker={worker} snapshot={snapshot} respond={respond} />
              ) : <Roster snapshot={snapshot} role={role} invite={invite} />}
            </div>
          </>
        ) : (
          <p className="wrap loading-panel" role="status">
            {loadError || connection === 'Reconnecting'
              ? 'Waiting for the server. The dashboard will reconnect automatically.'
              : 'Loading shift…'}
          </p>
        )}
      </main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
