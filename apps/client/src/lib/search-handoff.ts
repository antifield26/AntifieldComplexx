/** 用一次导航标识传递内存筛选词；退出账号时清除。 */
let pending: { token: string; query: string } | null = null
export function handoffSearch(query: string) {
  const token = crypto.randomUUID()
  pending = { token, query }
  return token
}
export function takeSearch(token: unknown) { return pending?.token === token ? pending?.query ?? '' : '' }
export function clearSearchHandoff() { pending = null }
