export type AdvisorCliArgs = {
  isSchedule: boolean
  isDryRun: boolean
  tickerArg?: string
  marketArg?: string
}

export function parseAdvisorCliArgs(argv: readonly string[]): AdvisorCliArgs {
  const isDryRun = argv.includes('--dry-run')
  const positionals = argv.filter((arg) => !arg.startsWith('-'))
  const isSchedule = positionals[0] === 'schedule'

  if (isSchedule) {
    return {
      isSchedule,
      isDryRun,
    }
  }

  return {
    isSchedule,
    isDryRun,
    tickerArg: positionals[0],
    marketArg: positionals[1],
  }
}
