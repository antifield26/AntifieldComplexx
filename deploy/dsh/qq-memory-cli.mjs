/** 本机管理员从只读快照导入 QQ 数据，并在 QQ 专用账号下审核候选。 */
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { QqMemory } from './qq-memory.mjs'

const [dbPath, action, first, second] = process.argv.slice(2)
if (!isAbsolute(dbPath ?? '') || !['import', 'pending', 'approve', 'reject'].includes(action)) {
  console.error('用法：qq-memory-cli.mjs <目标数据库绝对路径> import <源快照> <AppID 文件> | pending | approve <候选 ID> | reject <候选 ID>')
  process.exit(2)
}
const memory = new QqMemory(dbPath)
try {
  let result
  if (action === 'import') {
    if (!isAbsolute(first ?? '') || !isAbsolute(second ?? '')) throw new Error('需要源快照和 AppID 文件绝对路径')
    result = memory.importWorkbench(first, readFileSync(second, 'utf8').trim())
  } else if (action === 'pending') {
    result = memory.db.prepare('SELECT * FROM proposals ORDER BY created_at, id').all()
  } else {
    if (!/^[a-f0-9-]{36}$/u.test(first ?? '')) throw new Error('候选 ID 无效')
    result = { reviewed: memory.review(first, action === 'approve') }
  }
  console.log(JSON.stringify(result))
} finally {
  memory.db.close()
}
