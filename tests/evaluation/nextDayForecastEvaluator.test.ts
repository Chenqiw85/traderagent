import { describe, expect, it } from 'vitest'
import { NextDayForecastEvaluator } from '../../src/evaluation/NextDayForecastEvaluator.js'

describe('NextDayForecastEvaluator', () => {
  it('scores an up call as correct when the next close rises from the reference price', async () => {
    const evaluator = new NextDayForecastEvaluator([
      {
        predictedDirection: 'up',
        referencePrice: 100,
        targetPrice: 102,
        actualClose: 102,
        confidence: 0.7,
      },
    ])

    const result = await evaluator.run()

    expect(result.breakdown.hitRate).toBe(1)
    expect(result.breakdown.avgSignedReturn).toBeCloseTo(0.02, 5)
  })

  it('classifies a small move inside the flat threshold as flat', async () => {
    const evaluator = new NextDayForecastEvaluator([
      {
        predictedDirection: 'flat',
        referencePrice: 100,
        targetPrice: 100,
        actualClose: 100.3,
        confidence: 0.55,
      },
    ])

    const result = await evaluator.run()

    expect(result.breakdown.flatPrecision).toBe(1)
  })

  it('treats a flat call as zero signed return', async () => {
    const evaluator = new NextDayForecastEvaluator([
      {
        predictedDirection: 'flat',
        referencePrice: 100,
        targetPrice: 100,
        actualClose: 100.3,
        confidence: 0.55,
      },
    ])

    const result = await evaluator.run()

    expect(result.breakdown.avgSignedReturn).toBe(0)
  })
})
