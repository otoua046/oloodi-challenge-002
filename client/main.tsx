import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Role, Snapshot, Worker } from '../shared/types'
import { Icon, VenuePlan, type IconName } from './Icons'
import { Activity } from './Activity'
import { demoManager } from '../shared/types'
import { useShift } from './useShift'
import './style.css'

function formatDate(date: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(new Date(date))
}

function ShiftHeader({ shift }: { shift: Snapshot['shift'] }) {
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

function Metrics({ snapshot }: { snapshot: Snapshot }) {
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

const participationLabels = { uninvited: 'Uninvited', invited: 'Invited', accepted: 'Accepted' } as const

const portraits: Record<string, string> = {
  'worker-001': 'jordan', 'worker-002': 'alex-chen', 'worker-003': 'alex-rivera',
}

function Portrait({ worker }: { worker: Worker }) {
  const [failed, setFailed] = useState(false)
  const photo = portraits[worker.id]
  return photo && !failed
    ? <img className="avatar" src={'/assets/' + photo + '.jpg'} alt="" onError={() => setFailed(true)} />
    : <span className="avatar initials" aria-hidden="true">{worker.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span>
}

function Status({ worker }: { worker: Worker }) {
  const state = worker.attendance === 'not_started' ? worker.participation : worker.attendance
  const labels = { ...participationLabels, checked_in: 'Checked in', checked_out: 'Checked out' }
  return <span className={'badge ' + state}><i />{labels[state]}</span>
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
                  <Portrait worker={worker} />
                  <span className="worker-name">{worker.name}</span>
                </div>
              </th>
              <td><Status worker={worker} /></td>
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

function App() {
  const { snapshot, connection, loadError, invite } = useShift()
  const [role, setRole] = useState<Role>('manager')

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
              <rect width="32" height="32" rx="8" fill="#12574f" />
              <path d="M5 12q5-5 11 0t11 0M5 17q5-5 11 0t11 0M5 22q5-5 11 0t11 0" fill="none" stroke="#d9eba8" strokeWidth="2.3" />
            </svg>
            <span><b>Tideway</b><small>Staffing</small></span>
          </a>
          <nav aria-label="Shift navigation">
            <a href="#overview" aria-current={!activityOpen ? 'page' : undefined}>Overview</a>
            <a href="#activity" aria-current={activityOpen ? 'page' : undefined}>Activity</a>
          </nav>
          <div className="role-control">
            <label htmlFor="demo-role" className="sr-only">Demo role</label>
            {role === 'manager' && <span className="manager-name">{demoManager}</span>}
            <div className="role-select">
              <Icon name="shield" size={15} />
              <select
                id="demo-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="manager">Manager</option>
                <option value="viewer">Viewer</option>
              </select>
              <Icon name="down" size={13} />
            </div>
          </div>
        </div>
      </header>
      <main>
        <div className="screen-heading">
          <p>{activityOpen ? 'Shift history' : 'Staffing dashboard'}</p>
          <span
            role="status"
            aria-label={'Live updates: ' + connection}
            className={'connection ' + connection.toLowerCase()}
          >
            <i />
            {connection}
          </span>
        </div>
        {snapshot ? (
          <>
            <ShiftHeader shift={snapshot.shift} />
            {activityOpen ? <Activity events={snapshot.activity} shift={snapshot.shift} /> : <>
              <Metrics snapshot={snapshot} />
              <Roster snapshot={snapshot} role={role} invite={invite} />
            </>}
          </>
        ) : (
          <p className="loading-panel" role="status">
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
