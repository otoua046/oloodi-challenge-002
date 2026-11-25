// Reset through the running service so open dashboards see the new seed too.
const url = new URL('/api/demo/reset', process.env.APP_URL ?? 'http://127.0.0.1:' + (process.env.PORT ?? 3000))
const headers = { 'X-Demo-Role': 'manager' }
// A password-protected deployment accepts its password with any user name.
if (process.env.PREVIEW_PASSWORD) {
  headers.Authorization = 'Basic ' + Buffer.from('reset:' + process.env.PREVIEW_PASSWORD).toString('base64')
}
try {
  const response = await fetch(url, { method: 'POST', headers })
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()))
  const { revision } = await response.json()
  console.log('Demo restored at revision ' + revision)
} catch (error) {
  console.error('Could not reset ' + url.origin + '. Start the app and check the address.', error.message)
  process.exitCode = 1
}
