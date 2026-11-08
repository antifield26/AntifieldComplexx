/** 验证 DSH Web 本地换票的输入边界，不启动真实服务。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advertisedOrigin, readLaunchToken, secureDshCookie } from '../../deploy/dsh/web-broker.mjs'

const origin = 'https://ai.example.test'
const token = 'private-test-token-123456'

test('换票器只接受固定 HTTPS 根地址的唯一启动令牌', () => {
  assert.equal(advertisedOrigin(origin), origin)
  assert.throws(() => advertisedOrigin('http://ai.example.test'))
  assert.throws(() => advertisedOrigin(origin + '/nested/'))
  assert.equal(readLaunchToken(`dsh web: ${origin}/?token=${token}`, origin), token)
  for (const address of [
    `${origin}/?token=${token}&token=${token}`,
    `${origin}/?token=${token}&next=%2Fapi`,
    `${origin}/index.html?token=${token}`,
    `https://other.example.test/?token=${token}`,
    `${origin}/?token=%0d%0aBad`,
    `${origin}/?token=${token}#fragment`,
  ]) {
    assert.equal(readLaunchToken(`dsh web: ${address}`, origin), null)
  }
})

test('换票只发布受限的 DSH 会话 Cookie', () => {
  assert.equal(
    secureDshCookie(['dsh-auth-test=opaque.credential; Domain=.example.test; SameSite=Lax']),
    'dsh-auth-test=opaque.credential; Path=/; Secure; HttpOnly; SameSite=Strict',
  )
  assert.equal(secureDshCookie(['af_session=other']), null)
  assert.equal(secureDshCookie(['dsh-auth-test=one', 'dsh-auth-test=two']), null)
  assert.equal(secureDshCookie(['dsh-auth-test=one\r\nOther:header']), null)
  assert.equal(secureDshCookie(undefined), null)
})
