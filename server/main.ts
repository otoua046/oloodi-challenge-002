import { createApp } from './app.ts'

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'
const app = createApp({ databasePath: process.env.DATABASE_PATH ?? 'data/staffing.sqlite' })
app.server.listen(port, host, () => {
  console.log(`Staffing dashboard listening on http://${host}:${port}`)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close() })
