/** 原生发布配置的失败关闭和跨安装包版本门禁夹具；不执行真实构建或网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, URL } from 'node:url'
import { clientBuildArguments, parseClientOrigins, pinAndroidSdk, prepareAndroidProject } from '../build-client.mjs'
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

test('全新 Android 工程固定 SDK 并拒绝模板漂移', () => {
  const generated = 'android {\n    compileSdk = 37\n    defaultConfig {\n        targetSdk = 37\n    }\n}'
  const pinned = pinAndroidSdk(generated)
  assert.ok(pinned.includes('compileSdk = 36'))
  assert.ok(pinned.includes('targetSdk = 36'))
  assert.equal(pinAndroidSdk(pinned), pinned)
  assert.throws(() => pinAndroidSdk('compileSdk = 37'))
  assert.throws(() => pinAndroidSdk(`${generated}\ncompileSdk = 36`))
})

test('全新 Android 工程使用产品图标，资源缺失拒绝发布', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'antifield-client-build-'))
  try {
    const android = join(fixture, 'apps/client/src-tauri')
    mkdirSync(join(android, 'gen/android/app'), { recursive: true })
    writeFileSync(join(android, 'gen/android/app/build.gradle.kts'), 'compileSdk = 37\ntargetSdk = 37\n')
    assert.throws(() => prepareAndroidProject(fixture), /图标不完整/)
    cpSync(fileURLToPath(new URL('../../apps/client/src-tauri/icons/android', import.meta.url)), join(android, 'icons/android'), { recursive: true })
    prepareAndroidProject(fixture)
    const sourceIcon = readFileSync(join(android, 'icons/android/mipmap-xxxhdpi/ic_launcher.png'))
    const bundledIcon = readFileSync(join(android, 'gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'))
    assert.deepEqual(bundledIcon, sourceIcon)
    assert.ok(readFileSync(join(android, 'gen/android/app/build.gradle.kts'), 'utf8').includes('targetSdk = 36'))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
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
