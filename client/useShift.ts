import { useCallback, useEffect, useState } from 'react'
import type { InviteResponse, Role, Snapshot } from '../shared/types'

const endpoint = '/api/shifts/shift-001'
type Connection = 'Connecting' | 'Live' | 'Reconnecting'

export function useShift() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<Connection>('Connecting')
  const [loadError, setLoadError] = useState(false)

  // A slower read or write response can arrive after a newer stream event.
  const applySnapshot = useCallback((next: Snapshot) => {
    setSnapshot((current) => (current && current.revision > next.revision ? current : next))
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
      .then(async (response) => {
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

  async function invite(workerId: string, role: Role) {
    const response = await fetch(endpoint + '/workers/' + encodeURIComponent(workerId) + '/invite', {
      method: 'POST',
      headers: { 'X-Demo-Role': role },
    })
    if (!response.ok) {
      const problem = await response.json().catch(() => null)
      throw new Error(problem?.error?.message ?? 'Invitation could not be confirmed. Try again.')
    }
    const result = (await response.json()) as InviteResponse
    applySnapshot(result.snapshot)
  }

  return { snapshot, invite, connection, loadError }
}
