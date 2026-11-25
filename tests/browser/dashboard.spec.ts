import { once } from 'node:events'
import type { Server } from 'node:http'
import { expect, test as base, type Page } from '@playwright/test'
import { createApp } from '../../server/http/app.ts'

const shiftPath = '/api/shifts/shift-001'
const managerHeaders = { 'X-Demo-Role': 'manager' }

const test = base.extend<{ app: { url: string; server: Server } }>({
  app: async ({}, use) => {
    const { server, close } = createApp({ databasePath: ':memory:' })
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a TCP port')
      await use({ url: 'http://127.0.0.1:' + address.port, server })
    } finally {
      await close()
    }
  },
})

async function openDashboard(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  return page.evaluateHandle(() => document)
}

function row(page: Page, worker: string) {
  return page.getByRole('row').filter({ hasText: worker })
}

// Break the established TCP connection. Hold only the next stream request so
// ordinary API traffic can succeed during a deterministic interruption.
async function interruptStream(page: Page, server: Server) {
  let resume!: () => void
  const paused = new Promise<void>(resolve => {
    resume = resolve
  })
  await page.route(
    '**' + shiftPath + '/events',
    async route => {
      await paused
      await route.continue()
    },
    { times: 1 },
  )
  server.closeAllConnections()
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible()
  return resume
}

test('an open viewer dashboard receives an API-issued invitation', async ({ app, page, request }) => {
  const originalDocument = await openDashboard(page, app.url)
  await page.getByRole('combobox', { name: 'Demo role' }).selectOption('viewer')
  const alex = row(page, 'Alex Chen')
  await expect(alex.getByText(/^uninvited$/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Invite / })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Action' })).toHaveCount(0)

  const reply = await request.post(app.url + shiftPath + '/workers/worker-002/invite', {
    headers: managerHeaders,
  })
  expect(reply.ok()).toBe(true)
  await expect(alex.getByText(/^invited$/i)).toBeVisible()
  await expect(row(page, 'Alex Rivera').getByText(/^uninvited$/i)).toBeVisible()
  expect(await originalDocument.evaluate(doc => doc === document)).toBe(true)
})

test('the same page catches up on an invitation committed during a stream interruption', async ({
  app,
  page,
  request,
}) => {
  const originalDocument = await openDashboard(page, app.url)
  const resume = await interruptStream(page, app.server)
  const alex = row(page, 'Alex Rivera')
  try {
    const reply = await request.post(app.url + shiftPath + '/workers/worker-003/invite', {
      headers: managerHeaders,
    })
    expect(reply.ok()).toBe(true)
    await expect(alex.getByText(/^uninvited$/i)).toBeVisible()
  } finally {
    resume()
  }

  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(alex.getByText(/^invited$/i)).toBeVisible()
  expect(await originalDocument.evaluate(doc => doc === document)).toBe(true)
})

test('a manual invitation reflects the confirmed write while the stream is down', async ({ app, page }) => {
  await openDashboard(page, app.url)
  const resume = await interruptStream(page, app.server)
  try {
    const alex = row(page, 'Alex Chen')
    await alex.getByRole('button', { name: 'Invite Alex Chen' }).click()
    await expect(alex.getByText(/^invited$/i)).toBeVisible()
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible()
  } finally {
    resume()
  }
})

test('the roster and activity page show the same committed invitation', async ({ app, page }) => {
  await openDashboard(page, app.url)
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  await expect(row(page, 'Jordan Lee')).toContainText('Checked in')
  await expect(row(page, 'Jordan Lee')).toContainText('Nov 24, 4:55 PM')
  await expect(page.getByText('worker-001', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Invite Alex Chen' }).click()
  await expect(row(page, 'Alex Chen')).toContainText('Invited')
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText('Maya Patel invited Alex Chen')).toHaveCount(1)
  await expect(page.getByText('Jordan Lee accepted the shift')).toBeVisible()
  await expect(page.getByText('Jordan Lee checked in')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Maya Patel invited Alex Chen')).toBeVisible()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(row(page, 'Alex Chen')).toContainText('Invited')
})

test('worker responds in a separate session while the manager sees each change live', async ({
  app,
  page,
  browser,
}) => {
  await openDashboard(page, app.url)
  const session = await browser.newContext()
  try {
    const worker = await session.newPage()
    await openDashboard(worker, app.url)
    await worker.getByLabel('Demo role').selectOption('worker')
    await worker.getByLabel('Select worker').selectOption({ label: 'Alex Chen' })
    await page.getByRole('button', { name: 'Invite Alex Chen' }).click()
    const rosterRow = row(page, 'Alex Chen')
    for (const [button, status] of [
      ['Accept shift', 'Accepted'],
      ['Cancel shift', 'Cancelled'],
      ['Accept shift', 'Accepted'],
      ['Check in', 'Checked in'],
      ['Check out', 'Checked out'],
    ] as const) {
      await worker.getByRole('button', { name: button, exact: true }).click()
      await expect(rosterRow.getByText(status, { exact: true })).toBeVisible()
    }
    await expect(rosterRow.getByText('Checked out', { exact: true })).toHaveClass(/changed/)
    await expect(row(page, 'Jordan Lee').getByText('Checked in', { exact: true })).not.toHaveClass(/changed/)
    await expect(worker.getByText('Shift complete. You’re checked out.')).toBeVisible()
    await expect(worker.getByRole('listitem').filter({ hasText: 'Check out' })).toContainText('(done)')
    await worker.reload()
    await expect(worker.getByRole('heading', { name: 'Alex Chen' })).toBeVisible()
    await expect(worker.getByText('Checked out', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Activity' }).click()
    await expect(page.getByText('Alex Chen checked out', { exact: true })).toBeVisible()
  } finally {
    await session.close()
  }
})

test('activity uses the affected worker portrait, falls back to initials, and distinguishes resets', async ({
  app,
  page,
  request,
}) => {
  await page.route('**/assets/alex-chen.jpg', route => route.abort())
  await request.post(app.url + shiftPath + '/workers/worker-002/invite', { headers: managerHeaders })
  await request.post(app.url + '/api/demo/reset', { headers: managerHeaders })
  await page.setViewportSize({ width: 375, height: 800 })
  await openDashboard(page, app.url + '/#activity')
  const jordan = page.getByRole('listitem').filter({ hasText: 'Jordan Lee checked in' })
  await expect
    .poll(() => jordan.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  await expect(jordan.locator('img')).toHaveAttribute('src', '/assets/jordan.jpg')
  const alex = page.getByRole('listitem').filter({ hasText: 'Maya Patel invited Alex Chen' })
  await expect(alex.getByText('AC', { exact: true })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'restored the demo roster' }).locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('a manager resets the demo from the roster after confirming', async ({ app, page }) => {
  await openDashboard(page, app.url)
  await page.getByRole('button', { name: 'Invite Alex Chen' }).click()
  await expect(row(page, 'Alex Chen').getByText('Invited', { exact: true })).toBeVisible()

  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByRole('button', { name: 'Reset demo' }).click()
  await expect(row(page, 'Alex Chen').getByText('Invited', { exact: true })).toBeVisible()

  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('button', { name: 'Reset demo' }).click()
  await expect(page.getByText('The demo is back to the starting roster.')).toBeVisible()
  await expect(row(page, 'Alex Chen').getByText('Uninvited', { exact: true })).toBeVisible()

  await page.getByLabel('Demo role').selectOption('viewer')
  await expect(page.getByRole('button', { name: 'Reset demo' })).toHaveCount(0)
})
