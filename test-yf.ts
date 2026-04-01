import { YFinanceSource } from './src/data/yfinance.js'

const src = new YFinanceSource()

async function main() {
  try {
    const result = await src.fetch({ ticker: 'AAPL', market: 'US', type: 'technicals' })
    console.log('Success, data keys:', Object.keys(result))
    console.log('data type:', typeof result.data)
  } catch (err: any) {
    console.error('Error:', err.message)
    if (err.cause) console.error('Cause:', err.cause)
  }
}

main()
