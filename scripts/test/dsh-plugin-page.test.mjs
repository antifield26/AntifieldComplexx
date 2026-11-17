/** 核对插件查询参数和插件页上的 QQ、Minecraft Bot 显示条目。 */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pnpmArguments } from '../../deploy/dsh/pnpm-dsh.mjs'
import { addExternalPlugins, ensureExternalPlugins, EXTERNAL_PLUGINS, linkExternalPlugins } from '../../deploy/dsh/external-plugins.mjs'
import { initialize, load, pluginManagerGuard } from '../../deploy/dsh/plugin-page-hook.mjs'
import { installationNodeModules } from '../../deploy/dsh/web-broker.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

test('view 去掉 npm 不接受的重试参数，其它子命令保留', () => {
  assert.deepEqual(
    pnpmArguments(['view', '@deepseek-ai/dsh-experimental-voice-input-bundle', 'name', 'version', '--json', '--config.fetch-retries=0']),
    ['view', '@deepseek-ai/dsh-experimental-voice-input-bundle', 'name', 'version', '--json'],
  )
  assert.deepEqual(
    pnpmArguments(['--config.fetch-retries=2', 'view', 'pkg', '--json', '--registry=https://registry.example.test/']),
    ['view', 'pkg', '--json', '--registry=https://registry.example.test/'],
  )
  assert.deepEqual(
    pnpmArguments(['add', 'pkg', '--config.fetch-retries=0', '--config.lockfile=false']),
    ['add', 'pkg', '--config.fetch-retries=0', '--config.lockfile=false'],
  )
})

test('Web 配置追加两个显示插件并在重复写入时保持不变', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugins-'))
  try {
    const manifestPath = join(directory, 'package.json')
    const original = {
      name: 'web',
      private: true,
      dependencies: { '@deepseek-ai/kept': '1.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }
    writeFileSync(manifestPath, `${JSON.stringify(original, null, 2)}\n`)
    assert.equal(ensureExternalPlugins(directory), true)
    const saved = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(saved.dependencies['@deepseek-ai/kept'], '1.0.0')
    assert.deepEqual(saved.dsh.profile.bundles.slice(0, 2), original.dsh.profile.bundles)
    for (const plugin of EXTERNAL_PLUGINS) {
      assert.equal(saved.dependencies[plugin.name], plugin.spec)
      assert.equal(saved.dsh.profile.bundles.at(-2) === plugin.name || saved.dsh.profile.bundles.at(-1) === plugin.name, true)
    }
    const text = readFileSync(manifestPath, 'utf8')
    assert.equal(ensureExternalPlugins(directory), false)
    assert.equal(readFileSync(manifestPath, 'utf8'), text)
    assert.throws(() => addExternalPlugins([]))
    assert.equal(ensureExternalPlugins(join(directory, 'missing')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('已有依赖规格保持不变，只补上启用项', () => {
  const manifest = addExternalPlugins({
    dependencies: { '@antifield/dsh-qq-plugin': 'file:custom-qq' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  })
  assert.equal(manifest.dependencies['@antifield/dsh-qq-plugin'], 'file:custom-qq')
  assert.equal(manifest.dependencies['@antifield/dsh-mcbot-plugin'], 'file:antifield-mcbot-plugin')
  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base', '@antifield/dsh-qq-plugin', '@antifield/dsh-mcbot-plugin',
  ])
})

test('插件页保护拒绝停用两个显示插件，且不改其它模块', async () => {
  initialize(EXTERNAL_PLUGINS.map(plugin => plugin.name))
  assert.throws(() => initialize(['@tencent-connect/dsh-qqbot']))
  const fixture = 'export class PluginManager { protectsManager(name) { return name === "kept" } }\n'
  const patched = pluginManagerGuard(fixture)
  const directory = mkdtempSync(join(tmpdir(), 'dsh-guard-'))
  const modulePath = join(directory, 'manager.mjs')
  writeFileSync(modulePath, patched)
  try {
    const loaded = await import(pathToFileURL(modulePath).href)
    const manager = new loaded.PluginManager()
    assert.equal(manager.protectsManager('@antifield/dsh-qq-plugin'), true)
    assert.equal(manager.protectsManager('@antifield/dsh-mcbot-plugin'), true)
    assert.equal(manager.protectsManager('kept'), true)
    assert.equal(manager.protectsManager('other'), false)
    assert.equal(pluginManagerGuard(patched), patched)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  const passed = await load('file:///tmp/other.js', {}, async () => ({ format: 'module', source: 'export {}\n' }))
  assert.equal(passed.source, 'export {}\n')
  const managerUrl = 'file:///opt/antifield-dsh/current/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js'
  const guarded = await load(managerUrl, {}, async () => ({ format: 'module', source: fixture }))
  assert.match(guarded.source, /__antifieldExternalPlugins/)
  // 上游源码不进仓库。本机存在时才核对套用形状。
  const realPath = join(root, 'deploy/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js')
  if (existsSync(realPath)) {
    const real = readFileSync(realPath, 'utf8')
    assert.match(real, /protectsManager\(name\)/)
    assert.doesNotThrow(() => pluginManagerGuard(real))
  }
})

test('显示插件的补丁不装入 QQ 机器人或 Minecraft Bot 工具', () => {
  for (const name of ['qq', 'mcbot']) {
    const directory = join(root, 'deploy/dsh/plugins', name)
    const patch = readFileSync(join(directory, 'cordis.patch.yml'), 'utf8')
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.match(patch, new RegExp(`name: '${manifest.name.replace('/', '\\/')}'`))
    assert.doesNotMatch(patch, /appSecret|QQBOT_|im-qqbot|tool-plugin-manager|dsh-mcbot(?!-plugin)/)
    const locale = JSON.parse(readFileSync(join(directory, 'locale/zh-CN.json'), 'utf8'))
    assert.match(locale.meta.title, /QQ|Minecraft Bot/)
    assert.match(locale.meta.description, /antifield-dsh-/)
  }
  const broker = readFileSync(join(root, 'deploy/dsh/web-broker.mjs'), 'utf8')
  assert.match(broker, /plugin-page-guard\.mjs/)
  assert.match(broker, /ensureExternalPlugins/)
  assert.match(broker, /linkExternalPlugins/)
  const binary = join(root, 'deploy/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')
  assert.equal(installationNodeModules(binary), resolve(root, 'deploy/dsh/node_modules'))
})

test('显示插件接到配置目录，重复执行不改链接', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-link-'))
  const install = join(directory, 'install')
  const profile = join(directory, 'profile')
  try {
    for (const plugin of EXTERNAL_PLUGINS) {
      const packageDir = join(install, plugin.name)
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), '{}\n')
    }
    assert.equal(linkExternalPlugins(profile, install), true)
    assert.equal(linkExternalPlugins(profile, install), true)
    for (const plugin of EXTERNAL_PLUGINS) {
      const linked = join(profile, 'node_modules', plugin.name)
      assert.equal(lstatSync(linked).isSymbolicLink(), true)
      assert.equal(realpathSync(linked), realpathSync(join(install, plugin.name)))
    }
    assert.throws(() => linkExternalPlugins(profile, join(directory, 'missing')), /未安装/)
    assert.throws(() => linkExternalPlugins('', install), /位置无效/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('普通目录占用显示插件位置时拒绝链接', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-link-occupied-'))
  const install = join(directory, 'install')
  const profile = join(directory, 'profile')
  try {
    for (const plugin of EXTERNAL_PLUGINS) mkdirSync(join(install, plugin.name), { recursive: true })
    mkdirSync(join(profile, 'node_modules', EXTERNAL_PLUGINS[0].name), { recursive: true })
    assert.throws(() => linkExternalPlugins(profile, install), /已被占用/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('保护模块可以在启动时登记', () => {
  const guard = pathToFileURL(join(root, 'deploy/dsh/plugin-page-guard.mjs')).href
  const registered = spawnSync(process.execPath, ['--import', guard, '-e', 'console.log("guard-ok")'], { encoding: 'utf8' })
  assert.equal(registered.status, 0, registered.stderr)
  assert.match(registered.stdout, /guard-ok/)
  const directory = mkdtempSync(join(tmpdir(), 'dsh-guard-register-'))
  const packageDir = join(directory, 'node_modules', '@deepseek-ai', 'dsh-plugin-manager')
  try {
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-plugin-manager', type: 'module', exports: './lib/index.js',
    })}\n`)
    writeFileSync(join(packageDir, 'lib', 'index.js'), 'export class PluginManager { protectsManager(name) { return false } }\n')
    const checked = spawnSync(process.execPath, [
      '--import', guard, '--input-type=module', '-e',
      [
        "import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'",
        'const manager = Object.create(PluginManager.prototype)',
        "if (manager.protectsManager('@antifield/dsh-qq-plugin') !== true) process.exit(2)",
        "if (manager.protectsManager('@antifield/dsh-mcbot-plugin') !== true) process.exit(3)",
        "if (manager.protectsManager('@deepseek-ai/dsh-base') !== false) process.exit(4)",
        "console.log('protects-ok')",
      ].join('\n'),
    ], { cwd: directory, encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stderr)
    assert.match(checked.stdout, /protects-ok/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('配置不是普通文件时拒绝写入', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-plugins-dir-'))
  try {
    mkdirSync(join(directory, 'package.json'))
    assert.throws(() => ensureExternalPlugins(directory))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
