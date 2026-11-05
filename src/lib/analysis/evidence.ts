const NUMBER_TOKEN = /\d{1,3}(?:[ .]\d{3})+(?:[,.]\d+)?|\d+(?:[,.]\d+)?/g

function normalizeNumberToken(token: string): string {
  const compact = token.replace(/[ .]/g, '')
  const comma = compact.lastIndexOf(',')
  const dot = compact.lastIndexOf('.')
  const decimalIndex = Math.max(comma, dot)
  if (decimalIndex >= 0 && compact.length - decimalIndex - 1 <= 2) {
    const decimal = compact.slice(decimalIndex + 1).replace(/0+$/, '')
    return decimal
      ? `${compact.slice(0, decimalIndex)}.${decimal}`
      : compact.slice(0, decimalIndex)
  }
  return compact.replace(/[,.]/g, '')
}

export function numericValues(value: string): string[] {
  return (value.match(NUMBER_TOKEN) ?? []).map(normalizeNumberToken)
}

export function evidenceSupportsNumbers(
  statement: string,
  evidence: string,
): boolean {
  const evidenceNumbers = new Set(numericValues(evidence))
  return numericValues(statement).every((number) => evidenceNumbers.has(number))
}

export function calculatePercentageAmount(
  baseAmount: number,
  percentage: number,
): number {
  return Math.round(((baseAmount * percentage) / 100) * 100) / 100
}
