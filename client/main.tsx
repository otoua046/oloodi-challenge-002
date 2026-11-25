import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Role } from '../shared/types'
import { Icon } from './Icons'
import { ShiftHeader, Metrics, Roster } from './ShiftOverview'
import { WorkerShift } from './WorkerShift'
import { Activity } from './Activity'
import { demoManager } from '../shared/types'
import { useShift } from './useShift'
import './style.css'

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

  function renderPage() {
    if (!snapshot) return null
    if (activityOpen) {
      const events = role === 'worker' ? snapshot.activity.filter(event => event.workerId === worker?.id) : snapshot.activity
      return <Activity events={events} shift={snapshot.shift} />
    }
    if (role === 'worker') {
      return worker && <WorkerShift key={worker.id} worker={worker} snapshot={snapshot} respond={respond} />
    }
    return <><Metrics snapshot={snapshot} /><Roster snapshot={snapshot} role={role} invite={invite} /></>
  }

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
        <div className="screen-heading">
          <p>{activityOpen ? 'Shift history' : role === 'worker' ? 'My shift' : 'Staffing dashboard'}</p>
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
            {role === 'worker' && worker && <label className="worker-picker">
              Select worker
              <select value={worker.id} onChange={event => {
                sessionStorage.setItem('demo-worker', event.target.value)
                setWorkerId(event.target.value)
              }}>
                {snapshot.workers.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
              </select>
            </label>}
            <ShiftHeader shift={snapshot.shift} />
            {renderPage()}
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
