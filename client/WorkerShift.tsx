import { useState } from 'react'
import type { Snapshot, Worker } from '../shared/types'
import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions'
import { Icon } from './Icons'
import { Portrait } from './Portrait'
import { WorkerStatus, workerState, type WorkerState } from './WorkerStatus'
import type { useShift } from './useShift'

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

export function WorkerShift({ worker, snapshot, respond }: {
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
      <div className="identity"><Portrait id={worker.id} name={worker.name} /><h2>{worker.name}</h2></div>
      <div aria-live="polite"><WorkerStatus worker={worker} /></div>
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
