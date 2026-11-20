import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Config } from '../src/config.ts'
import { loadConfig } from '../src/config.ts'
import { RuntimeState } from '../src/state.ts'

export function baseEnv (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    HTTP_TOKEN: '0123456789abcdef0123456789abcdef',
    AI_ENABLED: 'false',
    DATA_DIR: path.join(os.tmpdir(), 'mcbot-test-data'),
    BOT_HOME_X: '175.5',
    BOT_HOME_Y: '64',
    BOT_HOME_Z: '410.5',
    SAFE_MIN_X: '111',
    SAFE_MAX_X: '239',
    SAFE_MIN_Z: '410',
    SAFE_MAX_Z: '474',
    FARM_MIN_X: '177',
    FARM_MAX_X: '183',
    FARM_MIN_Z: '432',
    FARM_MAX_Z: '439',
    FARM_GROUND_Y: '63',
    FARM_CROP_Y: '64',
    CHEST_X: '184',
    CHEST_Y: '64',
    CHEST_Z: '435',
    FISH_STAND_X: '204.5',
    FISH_STAND_Y: '63',
    FISH_STAND_Z: '469.5',
    FISH_WATER_X: '204.5',
    FISH_WATER_Y: '62.5',
    FISH_WATER_Z: '470.5',
    TREE_FARM_MIN_X: '180',
    TREE_FARM_MAX_X: '193',
    TREE_FARM_MIN_Z: '455',
    TREE_FARM_MAX_Z: '464',
    TREE_FARM_GROUND_Y: '63',
    TREE_FARM_LOG_MIN_Y: '64',
    TREE_FARM_MAX_Y: '96',
    ...overrides
  }
}

export function makeConfig (overrides: Partial<Config> = {}, envOverrides: Record<string, string | undefined> = {}): Config {
  return { ...loadConfig(baseEnv(envOverrides), '0.1.0'), ...overrides }
}

export function makeState (config: Config): RuntimeState {
  return new RuntimeState({
    version: config.version,
    username: config.botUsername,
    host: config.mcHost,
    port: config.mcPort,
    minecraftVersion: config.mcVersion === false ? 'auto' : config.mcVersion,
    presenceEnabled: config.presenceEnabled,
    presencePollMs: config.presencePollMs,
    presenceGraceMs: config.presenceGraceMs,
    presenceCheckMs: config.presenceCheckMs,
    aiEnabled: config.aiEnabled,
    aiProvider: config.aiModelProvider,
    aiModel: config.aiModelId,
    taskEnabled: config.taskEnabled,
    autonomyEnabled: config.autonomyEnabled,
    autonomyMaxToolCalls: config.autonomyMaxToolCalls
  })
}

export async function waitFor (predicate: () => boolean, timeoutMs = 2000, intervalMs = 10): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

export async function tempDir (prefix = 'mcbot-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function removeDir (dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
