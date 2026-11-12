/* 原生主窗口的静态缓存迁移。只移除当前本地来源的 Service Worker 和产品静态缓存，不读写账号或设备数据。 */
(() => {
  if (!('serviceWorker' in navigator)) return Promise.resolve()
  return navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    if (!registrations.length) return
    const removed = await Promise.all(registrations.map((registration) => registration.unregister()))
    if (removed.some((ok) => !ok)) throw new Error('native_static_cache_migration_failed')
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('antifieldcloud-static-')).map((key) => caches.delete(key)))
    location.reload()
  }).catch(() => console.warn('客户端静态缓存迁移失败，请重新打开应用'))
})()
