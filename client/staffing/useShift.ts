import { useCallback, useEffect, useState } from 'react'
import type { WorkerAction } from '../../shared/assignment-rules'
import { demoShiftId } from '../../shared/api-types'
import type { Role, Snapshot } from '../../shared/api-types'

const endpoint = '/api/shifts/' + demoShiftId
type Connection = 'Connecting' | 'Live' | 'Reconnecting'

export function useShift() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<Connection>('Connecting')
  const [loadError, setLoadError] = useState(false)

  // A slower read or write response can arrive after a newer stream event.
  const applySnapshot = useCallback((next: Snapshot) => {
    setSnapshot(current => (current && current.revision > next.revision ? current : next))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const events = new EventSource(endpoint + '/events')
    events.addEventListener('snapshot', (event: MessageEvent<string>) => {
      applySnapshot(JSON.parse(event.data) as Snapshot)
      setLoadError(false)
      setConnection('Live')
    })
    events.onerror = () => setConnection('Reconnecting')

    // The initial read can render while the live connection is being established.
    // Every newly connected stream also starts with the current state.
    fetch(endpoint, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Shift unavailable')
        applySnapshot((await response.json()) as Snapshot)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true)
      })

    return () => {
      controller.abort()
      events.close()
    }
  }, [applySnapshot])

  async function post<T>(path: string, headers: Record<string, string>): Promise<T> {
    const response = await fetch(path, { method: 'POST', headers })
    if (!response.ok) {
      const problem = await response.json().catch(() => null)
      throw new Error(problem?.error?.message ?? 'Could not confirm the change. Try again.')
    }
    return (await response.json()) as T
  }

  async function write(workerId: string, action: string, headers: Record<string, string>) {
    const path = endpoint + '/workers/' + encodeURIComponent(workerId) + '/' + action
    applySnapshot((await post<{ snapshot: Snapshot }>(path, headers)).snapshot)
  }

  function invite(workerId: string, role: Role) {
    if (!snapshot) throw new Error('Wait for the roster to load.')
    return write(workerId, 'invite', {
      'X-Demo-Role': role,
      'Idempotency-Key': workerId + '/invite/' + snapshot.revision,
    })
  }

  function respond(workerId: string, action: WorkerAction, revision: number) {
    return write(workerId, action, {
      'X-Demo-Role': 'worker',
      'X-Demo-Worker-Id': workerId,
      'Idempotency-Key': workerId + '/' + action + '/' + revision,
    })
  }

  async function reset(role: Role) {
    applySnapshot(await post<Snapshot>('/api/demo/reset', { 'X-Demo-Role': role }))
  }

  return { snapshot, invite, respond, reset, connection, loadError }
}
