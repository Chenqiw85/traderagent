import pino from 'pino'

const level = process.env['LOG_LEVEL'] ?? 'info'

const isProduction = process.env['NODE_ENV'] === 'production'

const rootLogger = pino({
  level,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
})

export function createLogger(name: string): pino.Logger {
  return rootLogger.child({ module: name })
}

export const logger = rootLogger
