import { useState } from 'react'
import type { Snapshot, Worker } from '../shared/types'
import { availableActions, workerActions, type WorkerAction } from '../shared/worker-actions'
import { Portrait } from './Portrait'
import { WorkerStatus } from './WorkerStatus'
import type { useShift } from './useShift'

export function WorkerShift({ worker, snapshot, respond }: {
  worker: Worker
  snapshot: Snapshot
  respond: ReturnType<typeof useShift>['respond']
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const actions = availableActions(worker)
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
    {worker.participation === 'uninvited' && <p className="viewer-note">You haven’t received an invitation for this shift.</p>}
    {actions.length > 0 && <div className="worker-actions">
      {actions.map(action => <button key={action} disabled={pending} className="invite" onClick={() => void perform(action)}>
        {workerActions[action].label}
      </button>)}
    </div>}
    {error && <p role="alert" className="feedback error">{error}</p>}
  </section>
}
