/** 公网界面开关：关闭后只保留说明页和分享页，loopback 与默认开启仍提供完整界面。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp, type AppContext } from '../src/app.ts'
import { hidesPublicShell } from '../src/http/public-shell.ts'
import type { Config } from '../src/config.ts'
import { cleanupDir, tempDataDir, testConfig, testDb } from './helpers.ts'
import { uploadFile } from './phase2-fixtures.ts'

const PUBLIC_HOST = { host: 'app.test' }
const HTML = { ...PUBLIC_HOST, accept: 'text/html' }

function writeShellAssets(dir: string): void {
  const web = join(dir, 'web')
  mkdirSync(join(web, 'assets'), { recursive: true })
  mkdirSync(join(web, 'icons'), { recursive: true })
  writeFileSync(join(web, 'sw.js'), 'self.skipWaiting()')
  writeFileSync(join(web, 'manifest.webmanifest'), '{"name":"test"}')
  writeFileSync(join(web, 'offline.html'), '<html>offline</html>')
  writeFileSync(join(web, 'favicon.svg'), '<svg></svg>')
  writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(web, 'icons', 'icon.png'), 'png')
}

async function withApp(overrides: Partial<Config>, run: (context: AppContext) => Promise<void>): Promise<void> {
  const dir = tempDataDir()
  writeShellAssets(dir)
  const db = testDb(dir)
  const context = await buildApp(testConfig(dir, overrides), db)
  try {
    await run(context)
  } finally {
    await context.app.close()
    db.close()
    cleanupDir(dir)
  }
}

function setCookieLines(header: string | string[] | undefined): string[] {
  if (header === undefined) return []
  return Array.isArray(header) ? header : [header]
}

function tokenFromUrl(url: string): string {
  const match = /\/s\/([A-Za-z0-9_-]+)$/.exec(url)
  assert.ok(match, `URL 形状不正确：${url}`)
  return match[1]!
}

test('hidesPublicShell 只在关闭开关且 Host 等于应用公网主机时成立', () => {
  const dir = tempDataDir()
  try {
    const open = testConfig(dir)
    assert.equal(hidesPublicShell(open, 'app.test'), false)
    const closed = { ...open, publicAppShell: false }
    assert.equal(hidesPublicShell(closed, 'app.test'), true)
    assert.equal(hidesPublicShell(closed, 'App.Test:443'), true)
    assert.equal(hidesPublicShell(closed, 'localhost'), false)
    assert.equal(hidesPublicShell(closed, '127.0.0.1'), false)
    assert.equal(hidesPublicShell(closed, '[::1]'), false)
    assert.equal(hidesPublicShell(closed, ''), false)
    assert.equal(hidesPublicShell(closed, undefined), false)
    assert.equal(hidesPublicShell(closed, 'ai.test'), false)
    assert.equal(hidesPublicShell({ ...closed, appOrigin: 'http://127.0.0.1:3000' }, '127.0.0.1'), false)
  } finally {
    cleanupDir(dir)
  }
})

test('默认开启时公网 Host 仍返回管理界面', async () => {
  await withApp({}, async ({ app }) => {
    const home = await app.inject({ method: 'GET', url: '/', headers: PUBLIC_HOST })
    assert.equal(home.statusCode, 200)
    assert.match(home.body, /<body>test<\/body>/)
    assert.equal(home.body.includes('请使用客户端'), false)

    const page = await app.inject({ method: 'GET', url: '/files', headers: HTML })
    assert.equal(page.statusCode, 200)
    assert.match(page.body, /<body>test<\/body>/)

    const share = await app.inject({
      method: 'GET',
      url: '/s/abcdefghij1234567890',
      headers: HTML,
    })
    assert.equal(share.statusCode, 200)
    assert.match(share.body, /<body>test<\/body>/)

    const unlock = await app.inject({
      method: 'POST',
      url: '/s/abcdefghij1234567890/unlock',
      headers: { ...HTML, origin: 'https://app.test', 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'password=correct-horse',
    })
    assert.equal(unlock.statusCode, 404)
    assert.equal(unlock.json().error.code, 'not_found')
  })
})

test('关闭后公网只返回说明页，loopback 与 API 保持原样', async () => {
  await withApp({ publicAppShell: false }, async (context) => {
    const { app } = context
    const home = await app.inject({ method: 'GET', url: '/', headers: PUBLIC_HOST })
    assertNotice(home)
    const htmlPage = await app.inject({ method: 'GET', url: '/files', headers: HTML })
    assertNotice(htmlPage)
    const plainPage = await app.inject({ method: 'GET', url: '/files', headers: PUBLIC_HOST })
    assert.equal(plainPage.statusCode, 404)
    assert.equal(plainPage.json().error.code, 'not_found')

    for (const path of ['/sw.js', '/manifest.webmanifest', '/offline.html', '/favicon.svg', '/index.html', '/assets/app.js', '/icons/icon.png']) {
      const asset = await app.inject({ method: 'GET', url: path, headers: PUBLIC_HOST })
      assert.equal(asset.statusCode, 404, path)
      assert.equal(asset.json().error.code, 'not_found', path)
      assert.equal(asset.headers['cache-control'], 'no-store', path)
      assert.equal(asset.body.includes('skipWaiting'), false)
      assert.equal(asset.body.includes('console.log'), false)
    }

    const loopback = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost' } })
    assert.equal(loopback.statusCode, 200)
    assert.match(loopback.body, /<body>test<\/body>/)
    const ipv4 = await app.inject({ method: 'GET', url: '/files', headers: { host: '127.0.0.1', accept: 'text/html' } })
    assert.match(ipv4.body, /<body>test<\/body>/)

    const health = await app.inject({ method: 'GET', url: '/healthz', headers: PUBLIC_HOST })
    assert.equal(health.statusCode, 200)
    assert.equal(health.json().ok, true)
    const version = await app.inject({ method: 'GET', url: '/api/version', headers: PUBLIC_HOST })
    assert.equal(version.statusCode, 401)

    await assertSharePage(context)
  })
})

function assertNotice(response: { statusCode: number; body: string; headers: Record<string, unknown> }): void {
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /<h1>请使用客户端<\/h1>/)
  assert.equal(response.body.includes('<body>test</body>'), false)
  assert.equal(response.body.includes('<script'), false)
  assert.match(String(response.headers['content-type']), /text\/html/)
  assert.match(String(response.headers['cache-control']), /no-store/)
  assert.match(String(response.headers['x-robots-tag']), /noindex/)
  assert.match(String(response.headers['content-security-policy']), /script-src 'self'/)
}

async function assertSharePage(context: AppContext): Promise<void> {
  const { app, db, files, shares } = context
  const file = await uploadFile(files, 'note.txt', 'hello share')
  db.prepare('UPDATE files SET name = ? WHERE id = ?').run('报告<script>.txt', file.id)
  const created = await shares.create(
    { username: 'admin', ip: '127.0.0.1' },
    file.id,
    { password: 'correct-horse' },
  )
  const token = tokenFromUrl(created.url)

  const curlShare = await app.inject({ method: 'GET', url: `/s/${token}`, headers: PUBLIC_HOST })
  assert.equal(curlShare.statusCode, 404)
  assert.equal(curlShare.json().error.code, 'not_found')

  const missing = await app.inject({ method: 'GET', url: '/s/nope', headers: HTML })
  assert.equal(missing.statusCode, 404)
  assert.match(missing.body, /分享链接不存在/)
  assert.match(String(missing.headers['content-type']), /text\/html/)

  const locked = await app.inject({ method: 'GET', url: `/s/${token}`, headers: HTML })
  assert.equal(locked.statusCode, 200)
  assert.match(locked.body, /报告&lt;script&gt;\.txt/)
  assert.equal(locked.body.includes('<script>'), false)
  assert.match(locked.body, /该分享需要密码/)
  assert.equal(locked.body.includes('/content'), false)

  const denied = await app.inject({
    method: 'POST',
    url: `/s/${token}/unlock`,
    headers: { ...HTML, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'password=correct-horse',
  })
  assert.equal(denied.statusCode, 403)

  const unlocked = await app.inject({
    method: 'POST',
    url: `/s/${token}/unlock`,
    headers: {
      ...HTML,
      origin: 'https://app.test',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'password=correct-horse',
  })
  assert.equal(unlocked.statusCode, 303)
  assert.equal(unlocked.headers.location, `/s/${token}`)
  const cookies = setCookieLines(unlocked.headers['set-cookie'])
  assert.equal(cookies.length, 2)
  assert.ok(cookies.some((line) => line.includes(`Path=/api/public/shares/${token}`)))
  assert.ok(cookies.some((line) => line.includes(`Path=/s/${token}`)))
  const session = /af_share=([^;]+)/.exec(cookies[0] ?? '')?.[1]
  assert.ok(session)

  const opened = await app.inject({
    method: 'GET',
    url: `/s/${token}`,
    headers: { ...HTML, cookie: `af_share=${session}` },
  })
  assert.equal(opened.statusCode, 200)
  assert.match(opened.body, /报告&lt;script&gt;\.txt/)
  assert.equal(opened.body.includes('<script>'), false)
  assert.match(opened.body, new RegExp(`/api/public/shares/${token}/content`))
  assert.equal(opened.body.includes('该分享需要密码'), false)
}
