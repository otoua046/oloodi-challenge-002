import type { ServerResponse } from 'node:http'
import type { Snapshot } from '../shared/types.ts'

export function liveDashboard() {
  // Each stream follows one shift. A blocked stream needs only that shift's newest snapshot when it drains.
  const clients = new Map<ServerResponse, { shiftId: string; pending: string | null }>()

  function event(snapshot: Snapshot) {
    return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
  }

  const heartbeat = setInterval(() => {
    for (const client of clients.keys()) {
      if (!client.writableNeedDrain) client.write(': keep-alive\n\n')
    }
  }, 15_000).unref()

  return {
    subscribe(client: ServerResponse, snapshot: Snapshot) {
      client.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
      const stream = { shiftId: snapshot.shift.id, pending: null as string | null }
      clients.set(client, stream)
      const drain = () => {
        if (stream.pending) {
          client.write(stream.pending)
          stream.pending = null
        }
      }
      client.on('drain', drain)
      client.once('close', () => {
        client.off('drain', drain)
        clients.delete(client)
      })
      client.write(`retry: 1000\n${event(snapshot)}`)
    },
    publish(snapshot: Snapshot) {
      const chunk = event(snapshot)
      for (const [client, stream] of clients) {
        if (stream.shiftId !== snapshot.shift.id) continue
        if (client.writableNeedDrain) stream.pending = chunk
        else client.write(chunk)
      }
    },
    // Shifts with at least one open stream.
    shifts() {
      return new Set([...clients.values()].map(stream => stream.shiftId))
    },
    close() {
      clearInterval(heartbeat)
      for (const client of clients.keys()) client.end()
      clients.clear()
    },
  }
}
