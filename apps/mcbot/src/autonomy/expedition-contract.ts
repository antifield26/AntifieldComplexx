/** 生存协作工具描述。仅描述输入，游戏权限由执行器校验。 */
export const OPERATIONS = ['goal', 'resume', 'abandon', 'status', 'scan', 'walk', 'follow', 'gather', 'craft', 'smelt', 'withdraw', 'deliver', 'locate', 'teleport', 'give'] as const
export type Operation = typeof OPERATIONS[number]

export const EXPEDITION_SCHEMA = {
  operation: { type: 'string', enum: OPERATIONS },
  item: { type: 'string', description: '原版物品 ID，如 iron_ingot。scan/gather 使用方块 ID，locate 使用结构 ID。' },
  quantity: { type: 'integer', minimum: 1, maximum: 64 },
  position: { type: 'string', description: '已加载方块或位置，格式为 x,y,z。' }
}
