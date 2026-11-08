/**
 * 对固定的腾讯 QQ 包施加接入补丁。先校验所有原始文件，再原子替换；
 * 任何上游形状变化均停止部署，避免跳过群聊、记忆、媒体和日志策略。
 */
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./node_modules/@tencent-connect/dsh-qqbot/', import.meta.url))
const policy = '../../../../../qq-policy.mjs'
const marker = '// antifieldcomplexx QQ 策略'
const files = [
  ['index.js', 'dc03a2712e87b10d7a83662b26284652fd59d7784ca2a10a21eb680d61aafa13', (source) =>
    one(source, "export const inject = ['agents'];", "export const inject = ['agents', 'tools'];")],
  ['gateway/middleware-setup.js', 'a1b31829997de50543eb0af7bdb1ca25fab41deb62c8f0870d79e62810973452', (source) => {
    let patched = splice(source, '    bot.use(historyBuffer({', '    // 5. 群聊 @bot 门控', '')
    patched = one(patched, '    bot.use(slash.middleware);', `    bot.use(async (ctx, next) => {
        if (allowQqCommand(ctx.message.kind, ctx.message.content ?? '')) return next();
    });
    bot.use((ctx, next) => ctx.message.kind === 'c2c' && /^\\/forget(?:\\s|$)/u.test(ctx.message.content?.trim() ?? '')
        ? next() : slash.middleware(ctx, next));`)
    patched = one(patched, "        strategy: 'merge',", "        strategy: 'queue',")
    return `import { allowQqCommand } from "${policy}";\n${patched}`
  }],
  ['gateway/bootstrap.js', '66dea47f05474ea8965a7ec9e0b60aeaead92bf416ec1493ccb4fe6940221a5c', (source) => {
    let patched = one(source,
      '    const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);',
      '    const deliverablesDeliverer = undefined;')
    patched = one(patched, '    registerSendFileTool(ctx, mediaSender, manager, config, logger);', '')
    patched = one(patched, '    ensureVisionInputModal(config.vision, logger);', '')
    patched = one(patched, "|| 'https://api.bot.qq.com',\n        userAgent,", "|| 'https://bots.qq.com',\n        userAgent,")
    patched = one(patched, '    registerDescribeImageTool(ctx, config.vision, logger);', `    registerQqPolicy(ctx.tools);
    registerDescribeImageTool(ctx, config.vision, logger);`)
    patched = one(patched, 'console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);', 'console.log("antifieldcomplexx-qq-ready");')
    patched = one(patched, "bot.on('disconnected', (event) => {", "bot.on('disconnected', (event) => {\n            console.log('antifieldcomplexx-qq-disconnected');")
    return `import { registerQqPolicy } from "${policy}";\n${patched}`
  }],
  ['transport/attachment.js', '5e8323b6075aeaccacef4203d2d13caea96f5b4035a0fbd4f23db1a9404931b3', (source) => {
    let patched = one(source, "(attachments ?? []).filter(a => classifyContentType(a.content_type) !== 'voice' && a.url)", "(attachments ?? []).filter(a => isImageContentType(a.content_type) && a.url).slice(0, 1)")
    patched = one(patched, 'buf = await download(att.url, maxBytes);', 'buf = await downloadQqImage(att.url, maxBytes);')
    patched = one(patched, 'writeFileSync(localPath, buf);', "writeFileSync(localPath, buf, { mode: 0o600, flag: 'wx' });")
    return `import { downloadQqImage } from "${policy}";\n${patched}`
  }],
  ['media/vision-tool.js', 'ff3e683e3df4532a35b6419138fb6fe195f4eba5da410682afb1db32ad6f0014', (source) => {
    let patched = splice(source,
      '            const loaded = await loadImageBytes(image, vision.maxBytes, exec.signal);',
      '            return { text, model: vision.model, image, mimeType: loaded.mediaType, bytes: loaded.data.length };',
      `            const bytes = await openQqImage(exec.agent, image, vision.maxBytes);
            const mediaType = sniffImageMediaType(bytes);
            if (!mediaType) throw new Error("QQ 图片格式无效");
            const loaded = { data: bytes, mediaType };
            const text = await describeQqImage(bytes, mediaType, prompt ?? vision.defaultPrompt, vision, exec.signal);
`)
    patched = one(patched, 'return { text, model: vision.model, image, mimeType:', 'return { text, model: vision.model, image: "当前图片", mimeType:')
    patched = one(patched, "    const llm = ctx.get('llm');\n    const attachments = ctx.get('attachments');\n", '')
    patched = splice(patched, '    if (!tools?.register || !llm?.stream || !attachments?.saveImage) {', '    const definition = {',
      '    if (!tools?.register) throw new Error("QQ 图片工具服务不可用");\n')
    patched = one(patched, 'Absolute path to a local image file, or an http(s) URL of the image.', '当前 QQ 消息已下载的图片路径。')
    patched = one(patched, '    tools.register(definition);', '    tools.register(definition, { when: ({ agent }) => canUseQqImage(agent) });')
    return `import { openQqImage, describeQqImage, canUseQqImage } from "${policy}";\n${patched}`
  }],
  ['transport/inbound.js', '5e7da8b6a8441d4d166bcb1129d61a7afd85d52f187b33f89edf27d354f080fe', (source) => {
    let patched = one(source, "    const scope = msg.kind === 'group' ? 'group' : 'c2c';\n    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;", `    const identity = inputScope(config.appId, msg);
    if (!identity || isQqMemberClearing(identity)) return;
    const { kind: scope, peer: peerId } = identity;`)
    patched = one(patched, "    const agentBody = assembleAgentBody(msg, mwState, scope, logger);", `    if (scope === 'c2c' && /^\\/forget(?:\\s|$)/u.test(msg.content?.trim() ?? '')) {
        if (msg.content.trim() !== '/forget confirm') {
            await bot.sendMarkdown(replyTarget, '发送 /forget confirm 清除本 Bot 可确认属于你的结构化记忆，并开启新会话。');
            return;
        }
        await clearQqMemory(identity, manager);
        await bot.sendMarkdown(replyTarget, '可确认属于你的记忆已清除，相关会话将重新开始。');
        return;
    }
    const agentBody = assembleAgentBody(msg, mwState, scope, logger);`)
    patched = one(patched, '    logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);', '')
    patched = one(patched, '        record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);',
      `        const peer = sessionPeer(identity);
        const key = manager.sessionKey(scope, peer);
        record = await manager.getOrCreate(scope, peer, identity.member, replyTarget);
        if (isQqMemberClearing(identity) || key !== manager.sessionKey(scope, peer)) return;`)
    patched = splice(patched,
      "    const content = [{ type: 'text', text: agentBody }];",
      '\n}\n// ═',
      `    const content = [{ type: 'text', text: scopedQqContext(identity) + agentBody }];
    const cleanup = bindQqTurn(record.agent, identity, mwState.downloadedFiles ?? []);
    try {
        record.agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
        if (scope === 'group') clearGroupHistory(config.appId, peerId);
        await record.agent.whenIdle();
    } finally {
        cleanup();
    }`)
    patched = one(patched, "                : `Image: ${url ?? filename ?? 'image'}`;", "                : 'Image: 图片不可用';")
    return `import { inputScope, scopedQqContext, bindQqTurn, clearQqMemory, isQqMemberClearing, sessionPeer } from "${policy}";\n${patched}`
  }],
  ['session/session-manager.js', '9022b7a7f056a69ac38cf0d57f6e1ea957a60f8f117ac34034a7755cecd5f577', (source) =>
    `import { qqSessionKey } from "${policy}";\n${one(source,
      '        return \`qqbot:\${this.config.appId}:\${scope}:\${peerId}\`;',
      '        return qqSessionKey(this.config.appId, scope, peerId);')}`],
]

function one(source, old, replacement) {
  if (source.indexOf(old) === -1 || source.indexOf(old) !== source.lastIndexOf(old)) throw new Error('腾讯插件补丁定位不唯一')
  return source.replace(old, () => replacement)
}

function splice(source, first, last, replacement) {
  const start = source.indexOf(first)
  const end = source.indexOf(last, start + first.length)
  if (start === -1 || end === -1) throw new Error('腾讯插件补丁定位失败')
  return source.slice(0, start) + replacement + source.slice(end)
}

const patched = files.map(([name, original, patch]) => {
  const path = join(root, 'lib', name)
  const source = readFileSync(path, 'utf8')
  const sha = createHash('sha256').update(source).digest('hex')
  if (sha !== original) throw new Error(`腾讯插件源文件校验失败：${name}。请从锁文件重新安装后再应用补丁。`)
  return { path, contents: `${marker}\n${patch(source)}` }
})
for (const { path, contents } of patched) {
  const temp = `${path}.af-patch`
  writeFileSync(temp, contents, { flag: 'wx' })
  renameSync(temp, path)
}
console.log('腾讯 QQ 固定版本接入补丁已应用')
