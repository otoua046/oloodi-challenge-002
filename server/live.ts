import type { ServerResponse } from 'node:http'
import type { Snapshot } from '../shared/types.ts'

export function liveDashboard() {
  // A blocked stream needs only the newest complete snapshot when it drains.
  const clients = new Map<ServerResponse, string | null>()

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
      clients.set(client, null)
      const drain = () => {
        const pending = clients.get(client)
        if (pending) {
          clients.set(client, null)
          client.write(pending)
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
      for (const client of clients.keys()) {
        if (client.writableNeedDrain) clients.set(client, chunk)
        else client.write(chunk)
      }
    },
    close() {
      clearInterval(heartbeat)
      for (const client of clients.keys()) client.end()
      clients.clear()
    },
  }
}
