import { describe, expect, it } from 'vitest'
import { matchesAiOrigin } from './ai-workspace'

describe('matchesAiOrigin', () => {
  it('只接受与配置源相同且没有用户信息的地址', () => {
    expect(matchesAiOrigin('https://ai.example.com/session/abc?x=1', 'https://ai.example.com')).toBe(true)
    expect(matchesAiOrigin('https://ai.example.com.evil.test/', 'https://ai.example.com')).toBe(false)
    expect(matchesAiOrigin('https://user:pass@ai.example.com/', 'https://ai.example.com')).toBe(false)
    expect(matchesAiOrigin('http://ai.example.com/', 'https://ai.example.com')).toBe(false)
    expect(matchesAiOrigin('https://ai.example.com/', 'not a url')).toBe(false)
  })
})
