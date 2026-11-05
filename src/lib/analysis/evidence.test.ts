import { describe, expect, it } from 'vitest'
import {
  calculatePercentageAmount,
  evidenceSupportsNumbers,
  numericValues,
} from './evidence'

describe('numeric evidence matching', () => {
  it('does not validate a currency amount from a percentage alone', () => {
    expect(evidenceSupportsNumbers('30000 PLN', '30% advance payment')).toBe(
      false,
    )
  })

  it('matches equivalent thousands and decimal formatting exactly', () => {
    expect(evidenceSupportsNumbers('184500 PLN', '184 500,00 PLN netto')).toBe(
      true,
    )
    expect(numericValues('3 200,00 zł')).toEqual(['3200'])
  })

  it('does not accept substring matches', () => {
    expect(evidenceSupportsNumbers('300 PLN', '3000 PLN')).toBe(false)
  })

  it('calculates a percentage amount deterministically without treating it as source text', () => {
    expect(calculatePercentageAmount(184500, 30)).toBe(55350)
    expect(
      evidenceSupportsNumbers(
        '55350 PLN',
        'Zamawiający zapłaci zaliczkę w wysokości 30% wynagrodzenia za wdrożenie',
      ),
    ).toBe(false)
  })
})
