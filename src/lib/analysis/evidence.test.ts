import { describe, expect, it } from 'vitest'
import { evidenceSupportsNumbers, numericValues } from './evidence'

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
})
