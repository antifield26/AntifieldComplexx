/* DSH 的浏览器模块加载器提供 React 与设置席位。主站标识之外没有跨源参数。 */
window.__ModuleLoader__.load({
  id: '@antifield/dsh-qq-plugin',
  factory(require) {
    const { createElement, useEffect, useState } = require('react')
    const labels = { ready: '已绑定，网关在线', connecting: '正在连接', unbound: '未绑定', unavailable: 'QQ 服务暂不可用' }

    function QqSettings() {
      const [state, setState] = useState(null)
      useEffect(() => {
        const controller = new AbortController()
        let timer
        async function refresh() {
          try {
            const result = await fetch('/antifield/qq-status', { cache: 'no-store', signal: controller.signal })
            if (!result.ok) throw new Error()
            setState(await result.json())
          } catch {
            if (!controller.signal.aborted) setState(previous => ({ ...previous, phase: 'unavailable' }))
          }
          if (!controller.signal.aborted) timer = setTimeout(refresh, 5000)
        }
        void refresh()
        return () => { controller.abort(); clearTimeout(timer) }
      }, [])
      return createElement('section', null,
        createElement('p', { role: 'status' }, state ? labels[state.phase] ?? labels.unavailable : '正在读取状态…'),
        state?.managementUrl
          ? createElement('a', { href: state.managementUrl, rel: 'noreferrer' }, '在主站管理绑定')
          : createElement('p', null, '请在 AntifieldComplexx 主站打开 QQ 机器人设置。'),
      )
    }

    return {
      name: 'antifield-qq-settings',
      inject: ['slots'],
      apply(ctx) {
        const dispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'qqbot', order: 7, label: 'QQ 机器人',
        }, QqSettings))
        ctx.effect(() => dispose)
      },
    }
  },
})
