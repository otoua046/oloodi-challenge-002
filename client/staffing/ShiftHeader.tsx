import type { Snapshot } from '../../shared/api-types'
import { Icon, VenuePlan } from '../ui/Icons'
import { Portrait } from '../ui/Portrait'
import { formatDate } from './format'
import { assignmentState, statusLabels } from './WorkerStatus'

export function ShiftHeader({
  snapshot,
  connection,
  detailed,
}: {
  snapshot: Snapshot
  connection: string
  detailed: boolean
}) {
  const { shift, workers, assignments } = snapshot
  const { startsAt, endsAt, timeZone } = shift
  const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } as const
  const day = formatDate(startsAt, timeZone, dateOptions)
  const lastDay = formatDate(endsAt, timeZone, dateOptions)
  const time = { hour: 'numeric', minute: '2-digit' } as const
  // Accepted assignments hold a place throughout attendance. The rest of the places are open.
  const crew = assignments.filter(assignment => assignment.participation === 'accepted')
  const names = new Map(workers.map(worker => [worker.id, worker.name]))
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
          <span
            role="status"
            aria-label={'Live updates: ' + connection}
            className={'connection ' + connection.toLowerCase()}
          >
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
          {detailed && (
            <ul className="crew" aria-label="Crew places">
              {Array.from({ length: shift.requiredWorkers }, (_, index) => {
                const assignment = crew[index]
                const name = assignment ? (names.get(assignment.workerId) ?? '') : ''
                return assignment ? (
                  <li
                    key={assignment.workerId}
                    className={assignment.attendance}
                    style={{ animationDelay: 120 + index * 90 + 'ms' }}
                  >
                    <Portrait id={assignment.workerId} name={name} />
                    {name}
                    <small>{statusLabels[assignmentState(assignment)]}</small>
                  </li>
                ) : (
                  <li key={index} className="open" style={{ animationDelay: 120 + index * 90 + 'ms' }}>
                    <span className="avatar">
                      <Icon name="open" size={22} />
                    </span>
                    Open
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {detailed && <Metrics snapshot={snapshot} />}
      </div>
    </section>
  )
}

function Metrics({ snapshot }: { snapshot: Snapshot }) {
  const { counts, shift } = snapshot
  const metrics = [
    ['Filled spots', counts.filled],
    ['Open spots', counts.remaining],
    ['Checked in', counts.checkedIn],
    ['Checked out', counts.checkedOut],
  ] as const
  return (
    <dl className="metrics" aria-label="Shift staffing counts">
      {metrics.map(([label, value], index) => (
        <div className="metric" key={label}>
          <dt>{label}</dt>
          <dd>
            {/* Keyed by value so a changed count replays its entrance. */}
            <span key={value} className="count">
              {value}
            </span>
            {index === 0 && <small> / {shift.requiredWorkers}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
