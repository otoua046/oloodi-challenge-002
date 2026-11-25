import type { ActivityEvent, Shift } from '../shared/types'
import { Icon } from './Icons'
import { Portrait } from './Portrait'

function Description({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case 'invited': return <><strong>{event.actor}</strong> invited <strong>{event.workerName}</strong></>
    case 'accepted': return <><strong>{event.actor}</strong> accepted the shift</>
    case 'declined': return <><strong>{event.actor}</strong> declined the invitation</>
    case 'cancelled': return <><strong>{event.actor}</strong> cancelled their shift</>
    case 'checked_in': return <><strong>{event.actor}</strong> checked in</>
    case 'checked_out': return <><strong>{event.actor}</strong> checked out</>
    case 'reset': return <><strong>{event.actor}</strong> restored the demo roster</>
  }
}

export function Activity({ events, shift }: { events: ActivityEvent[]; shift: Shift }) {
  const options = { timeZone: shift.timeZone }
  const date = new Intl.DateTimeFormat('en-US', { ...options, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const time = new Intl.DateTimeFormat('en-US', { ...options, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  const days = new Map<string, ActivityEvent[]>()
  for (const event of events) {
    const day = date.format(new Date(event.occurredAt))
    const entries = days.get(day)
    if (entries) entries.push(event)
    else days.set(day, [event])
  }
  return <section className="panel activity" aria-labelledby="activity-title">
    <div className="panel-heading"><h2 id="activity-title">Shift activity</h2><span>Newest first</span></div>
    {[...days].map(([day, entries]) => <section key={day} className="day">
      <h3>{day}</h3>
      <ol>{entries.map(event => <li key={event.id}>
        {event.workerId && event.workerName
          ? <Portrait id={event.workerId} name={event.workerName} />
          : <span className="event-icon"><Icon name="clock" size={16} /></span>}
        <span className="event-description"><Description event={event} /></span>
        <time dateTime={event.occurredAt}>{time.format(new Date(event.occurredAt))}</time>
      </li>)}</ol>
    </section>)}
    {!events.length && <p className="viewer-note">No activity recorded yet.</p>}
  </section>
}
