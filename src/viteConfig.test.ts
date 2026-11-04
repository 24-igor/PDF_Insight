import { describe, expect, it } from 'vitest'
import config from '../vite.config'
import type { ConfigEnv, UserConfig } from 'vite'

describe('local Vite configuration', () => {
  it('serves the app from the root path', () => {
    const env: ConfigEnv = {
      command: 'serve',
      mode: 'development',
      isSsrBuild: false,
      isPreview: false,
    }
    const resolved =
      typeof config === 'function' ? config(env) : (config as UserConfig)
    expect(resolved.base).toBe('/')
  })
})
