import type { ServerResponse } from 'node:http'
import type { Snapshot } from '../shared/types.ts'

export function liveDashboard() {
  const clients = new Set<ServerResponse>()

  function event(snapshot: Snapshot) {
    return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
  }

  function send(client: ServerResponse, chunk: string) {
    // Slow clients can recover from a fresh snapshot instead of buffering an event history.
    if (!client.write(chunk)) client.destroy()
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) send(client, ': keep-alive\n\n')
  }, 15_000).unref()

  return {
    subscribe(client: ServerResponse, snapshot: Snapshot) {
      client.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
      clients.add(client)
      client.once('close', () => clients.delete(client))
      send(client, `retry: 1000\n${event(snapshot)}`)
    },
    publish(snapshot: Snapshot) {
      const chunk = event(snapshot)
      for (const client of clients) send(client, chunk)
    },
    close() {
      clearInterval(heartbeat)
      for (const client of clients) client.end()
      clients.clear()
    },
  }
}
