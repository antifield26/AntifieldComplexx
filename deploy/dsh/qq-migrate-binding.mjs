/** 导入旧绑定。root 只读取固定凭据，QQ 服务账号经 stdin 写入自己的目录。 */
import { spawnSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBinding, readBinding, writeBinding } from './qq-binding.mjs'

const target = '/var/lib/antifield-dsh-qq/binding.json'

function legacy(name) {
  let fd
  try { fd = openSync(`/etc/antifieldcloud/dsh/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o077) || info.size > 65536) throw new Error()
    return readFileSync(fd, 'utf8').trim()
  } finally { closeSync(fd) }
}

function asService(mode, input) {
  return spawnSync('/usr/sbin/runuser', ['-u', 'antifield-dsh-qq', '--', process.execPath, fileURLToPath(import.meta.url), mode], {
    input, stdio: ['pipe', 'ignore', 'ignore'],
  }).status
}

try {
  if (process.getuid() !== 0) {
    try { readBinding(target) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (process.argv[2] === 'check') process.exit(2)
      if (process.argv[2] !== 'migrate') throw new Error()
      writeBinding(target, parseBinding(JSON.parse(readFileSync(0, 'utf8'))))
    }
  } else {
    const present = asService('check')
    if (present === 2) {
      const appId = legacy('qq-app-id')
      const appSecret = legacy('qq-app-secret')
      const access = legacy('qq-access.json')
      let binding = null
      if (appId !== null || appSecret !== null || access !== null) {
        const { direct, groups } = JSON.parse(access)
        if (!Array.isArray(direct) || !Array.isArray(groups)) throw new Error()
        binding = parseBinding({ version: 1, binding: {
          appId, appSecret, direct: [...new Set(direct)], groups: [...new Set(groups)],
        } })
      }
      if (asService('migrate', JSON.stringify({ version: 1, binding })) !== 0) throw new Error()
    } else if (present !== 0) throw new Error()
  }
} catch {
  console.error('QQ 绑定迁移失败，请检查绑定文件和旧配置权限')
  process.exitCode = 1
}
