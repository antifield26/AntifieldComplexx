/**
 * 按部署用途构建发布包，校验包类型、版本、文件清单和逐项 SHA-256。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MANIFEST = 'release-files.json'
const common = new Set([
  'package.json', 'package-lock.json', 'scripts/release-files.mjs', 'scripts/deploy-state.mjs', 'deploy/tool-versions.json'
])
const workbench = new Set([
  'apps/workbench/package.json', 'README.md', 'AGENTS.md', 'CHANGELOG.md', 'LICENSE',
  'apps/mcbot/src/tasks/store.ts', 'apps/mcbot/src/goals/store.ts', 'apps/mcbot/src/autonomy/world-memory.ts'
])

function allowed(kind, path) {
  if (common.has(path)) return true
  if (kind === 'mcbot') {
    return path === 'apps/mcbot/package.json' || /^apps\/mcbot\/(src\/.+\.ts|deploy\/[\w.-]+)$/.test(path)
  }
  return workbench.has(path) ||
    /^apps\/workbench\/server\/src\/.+\.ts$/.test(path) ||
    /^scripts\/[\w.-]+\.(mjs|ps1|sh)$/.test(path) ||
    /^(?:deploy|docs)\//.test(path)
}

function checkPath(path) {
  if (!/^[\w./-]+$/.test(path) ||
      path.split('/').some(part => !part || part === '..' || part.startsWith('.') || part === 'node_modules')) {
    throw new Error('invalid_release_path')
  }
}

function listing(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    checkPath(relative)
    if (entry.isDirectory()) files.push(...listing(directory, relative))
    else if (entry.isFile()) files.push(relative)
    else throw new Error('invalid_release_entry')
  }
  return files
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verifyVersion(directory, kind, version) {
  if (!['workbench', 'mcbot'].includes(kind) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('invalid_release_version')
  const pkg = JSON.parse(readFileSync(join(directory, 'apps', kind, 'package.json'), 'utf8'))
  const root = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'))
  if ([pkg.version, root.version, lock.version, lock.packages?.['']?.version, lock.packages?.['apps/' + kind]?.version]
    .some(found => found !== version)) throw new Error('release_version_mismatch')
}

export function stageRelease(kind, root, directory, version) {
  verifyVersion(root, kind, version)
  const paths = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' }).split('\0').filter(path => path && allowed(kind, path))
  if (kind === 'workbench') paths.push(...listing(root, 'apps/workbench/web/dist'))
  mkdirSync(directory)
  const files = {}
  for (const path of [...new Set(paths)].sort()) {
    checkPath(path)
    const source = join(root, path)
    if (!lstatSync(source).isFile()) throw new Error('invalid_release_source:' + path)
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    files[path] = sha256(target)
  }
  writeFileSync(join(directory, MANIFEST), JSON.stringify({ version, kind, files }) + '\n')
  verifyRelease(kind, directory, version)
}

export function verifyRelease(kind, directory, version) {
  verifyVersion(directory, kind, version)
  const manifest = JSON.parse(readFileSync(join(directory, MANIFEST), 'utf8'))
  const files = listing(directory).filter(path => path !== MANIFEST)
  const required = ['apps/' + kind + '/package.json', ...common]
  if (kind === 'workbench') required.push('apps/workbench/server/src/main.ts', 'apps/workbench/web/dist/index.html',
    'deploy/dsh/package-lock.json', 'scripts/backup-mcbot-state.mjs', ...workbench)
  else required.push('apps/mcbot/src/main.ts', 'apps/mcbot/deploy/mcbot.service')
  if (manifest.kind !== kind || manifest.version !== version || Object.keys(manifest.files).length !== files.length ||
      required.some(path => !files.includes(path))) throw new Error('invalid_release_manifest')
  for (const path of files) {
    if ((!allowed(kind, path) && !(kind === 'workbench' && path.startsWith('apps/workbench/web/dist/'))) ||
        manifest.files[path] !== sha256(join(directory, path))) throw new Error('invalid_release_file:' + path)
  }
}

if (import.meta.main) {
  const [command, kind, directory, version, root] = process.argv.slice(2)
  if (command === 'stage') stageRelease(kind, root, directory, version)
  else if (command === 'verify') verifyRelease(kind, directory, version)
  else throw new Error('invalid_release_command')
}
