/** 原生发布配置的失败关闭和跨安装包版本门禁夹具；不执行真实构建或网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clientBuildArguments, parseClientOrigins } from '../build-client.mjs'
import { clientVersionErrors } from '../check-client-version.mjs'

const config = 'VITE_API_ORIGIN=https://app.example.com\nVITE_AI_ORIGIN=https://ai.example.com\nVITE_ACCESS_ORIGIN=https://team.cloudflareaccess.com'
test('客户端构建拒绝缺失源、明文、凭据、任意路径及混入密钥', () => {
  const result = parseClientOrigins(config)
  assert.equal(result.VITE_API_ORIGIN, 'https://app.example.com')
  for (const value of ['', config.replace('https://app', 'http://app'), config.replace('https://app', 'https://user:secret@app'), config.replace('app.example.com', 'app.example.com/api'), `${config}\nAPI_KEY=secret`]) {
    assert.throws(() => parseClientOrigins(value))
  }
  assert.throws(() => parseClientOrigins(config, { VITE_API_ORIGIN: 'https://ai.example.com' }))
  assert.equal(parseClientOrigins(config, { VITE_API_ORIGIN: 'https://other.example.com/' }).VITE_API_ORIGIN, 'https://other.example.com')
})
test('构建目标固定为 NSIS 或 arm64 APK', () => {
  assert.ok(clientBuildArguments('windows').includes('nsis'))
  assert.deepEqual(clientBuildArguments('android'), ['android', 'build', '--target', 'aarch64', '--apk', '--ci'])
  assert.throws(() => clientBuildArguments('anything'))
})
test('任一 Rust、Tauri 或登记版本漂移都会失败', () => {
  const sources = {
    'apps/client/package.json': '{"version":"1.2.1"}',
    'apps/client/src/lib/app-version.ts': "export const APP_VERSION = '1.2.1'",
    'apps/client/src-tauri/Cargo.toml': '[package]\nname = "antifieldcomplexx-client"\nversion = "1.2.1"',
    'apps/client/src-tauri/tauri.conf.json': '{"version":"1.2.1"}',
    'apps/client/src-tauri/Cargo.lock': 'name = "antifieldcomplexx-client"\nversion = "1.2.1"',
  }
  assert.deepEqual(clientVersionErrors('1.2.1', sources), [])
  for (const key of Object.keys(sources)) assert.equal(clientVersionErrors('1.2.1', { ...sources, [key]: sources[key].replaceAll('1.2.1', '1.2.0') }).length, 1)
})
