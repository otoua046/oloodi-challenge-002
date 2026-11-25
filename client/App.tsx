import { useEffect, useState } from 'react'
import type { Role } from '../shared/api-types'
import { demoManager } from '../shared/api-types'
import { Activity } from './staffing/Activity'
import { Roster } from './staffing/Roster'
import { ShiftHeader } from './staffing/ShiftHeader'
import { useShift } from './staffing/useShift'
import { WorkerShift } from './staffing/WorkerShift'
import { Icon } from './ui/Icons'
import { PhoneFrame } from './ui/PhoneFrame'
import { Portrait } from './ui/Portrait'

// The app shell: header, demo role and worker pickers, and which screen to show.
export function App() {
  const { snapshot, connection, loadError, invite, respond, reset } = useShift()
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

  function renderPage() {
    if (!snapshot) return null
    if (activityOpen) {
      const events =
        role === 'worker' ? snapshot.activity.filter(event => event.workerId === worker?.id) : snapshot.activity
      return <Activity events={events} shift={snapshot.shift} />
    }
    if (role === 'worker') {
      const assignment = snapshot.assignments.find(item => item.workerId === worker?.id)
      return (
        worker && (
          <WorkerShift key={worker.id} worker={worker} assignment={assignment} snapshot={snapshot} respond={respond} />
        )
      )
    }
    return <Roster snapshot={snapshot} role={role} invite={invite} reset={reset} />
  }

  const page = snapshot && (
    <>
      <ShiftHeader snapshot={snapshot} connection={connection} detailed={!activityOpen && role !== 'worker'} />
      <div className="wrap content">{renderPage()}</div>
    </>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="#overview" aria-label="Tideway Staffing overview">
            <svg viewBox="0 0 32 32" width="38" height="38" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#d9eba8" />
              <path
                d="M5 12q5-5 11 0t11 0M5 17q5-5 11 0t11 0M5 22q5-5 11 0t11 0"
                fill="none"
                stroke="#12574f"
                strokeWidth="2.3"
              />
            </svg>
            <span>
              <b>Tideway</b>
              <small>Staffing</small>
            </span>
          </a>
          <nav aria-label="Shift navigation">
            <a href="#overview" aria-current={!activityOpen ? 'page' : undefined}>
              Overview
            </a>
            <a href="#activity" aria-current={activityOpen ? 'page' : undefined}>
              Activity
            </a>
          </nav>
          <div className="role-control">
            <label htmlFor="demo-role" className="sr-only">
              Demo role
            </label>
            <span className="acting-as">Acting as</span>
            {role === 'manager' && <span className="manager-name">{demoManager}</span>}
            {role === 'worker' && snapshot && worker && (
              <div className="role-select">
                <Portrait id={worker.id} name={worker.name} />
                <select
                  aria-label="Select worker"
                  value={worker.id}
                  onChange={event => {
                    sessionStorage.setItem('demo-worker', event.target.value)
                    setWorkerId(event.target.value)
                  }}
                >
                  {snapshot.workers.map(person => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <Icon name="down" size={13} />
              </div>
            )}
            <div className="role-select">
              <Icon name="shield" size={15} />
              <select id="demo-role" value={role} onChange={event => selectRole(event.target.value as Role)}>
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
        {page ? (
          role === 'worker' ? (
            <PhoneFrame>{page}</PhoneFrame>
          ) : (
            page
          )
        ) : (
          <p className="wrap loading-panel" role="status">
            {loadError || connection === 'Reconnecting'
              ? 'Waiting for the server. The dashboard will reconnect automatically.'
              : 'Loading shift…'}
          </p>
        )}
      </main>
    </div>
  )
}
