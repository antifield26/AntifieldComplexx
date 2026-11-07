/**
 * 饥饿时的本地找食顺序：背包、附近掉落、食物箱，然后才排队现有的种田或钓鱼。
 * 不打猎、不使用熔炉，也不额外调用模型。
 */

export const FOOD_PICKUP_RADIUS = 8

export type FoodReflexStep = 'eat' | 'pickup' | 'chest' | 'task' | 'done'

export function chooseFoodReflex (input: {
  hungry: boolean
  inventoryFood: number
  nearbyDrops: number
  triedPickup: boolean
  triedChest: boolean
  triedTask: boolean
}): FoodReflexStep {
  if (!input.hungry) return 'done'
  if (input.inventoryFood > 0) return 'eat'
  if (input.nearbyDrops > 0 && !input.triedPickup) return 'pickup'
  if (!input.triedChest) return 'chest'
  if (!input.triedTask) return 'task'
  return 'done'
}

export function droppedItemName (entity: {
  name?: string
  displayName?: string
  itemName?: string
  getDroppedItem?: () => { name?: string } | null
}): string | null {
  const fromMethod = entity.getDroppedItem?.()?.name
  const name = entity.itemName ?? fromMethod ?? null
  if (!name) return null
  if (entity.name !== 'item' && entity.displayName !== 'Item' && !entity.itemName) return null
  return name
}
