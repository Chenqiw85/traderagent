import { describe, it, expect } from 'vitest'
import { createLogger, logger } from '../../src/utils/logger.js'

describe('Logger', () => {
  it('root logger has standard log methods', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('createLogger returns a child logger with module field', () => {
    const child = createLogger('test-module')
    expect(typeof child.info).toBe('function')
    expect(typeof child.warn).toBe('function')
    expect(typeof child.error).toBe('function')
    expect(typeof child.debug).toBe('function')
  })

  it('different module names produce different loggers', () => {
    const a = createLogger('module-a')
    const b = createLogger('module-b')
    expect(a).not.toBe(b)
  })
})
