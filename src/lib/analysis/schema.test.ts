import { describe, expect, it } from 'vitest'
import { countSentences, isConciseSummary } from './schema'

describe('analysis quality constraints', () => {
  it('requires a three-to-five sentence summary', () => {
    expect(
      countSentences('Pierwsze zdanie. Drugie zdanie. Trzecie zdanie.'),
    ).toBe(3)
    expect(isConciseSummary('Pierwsze zdanie. Drugie zdanie.')).toBe(false)
    expect(
      isConciseSummary(
        'Pierwsze zdanie. Drugie zdanie. Trzecie zdanie. Czwarte zdanie.',
      ),
    ).toBe(true)
  })

  it('rejects an excessively long summary', () => {
    expect(isConciseSummary(`${'Długie zdanie. '.repeat(300)}`)).toBe(false)
  })
})
