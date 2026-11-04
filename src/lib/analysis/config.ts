export type AnalysisScope = 'first-page' | 'full-document'

// Full-document analysis is enabled for the Phase 6 contract acceptance test.
export const ANALYSIS_SCOPE: AnalysisScope = 'full-document'

// Temporary production-testing cap. Raise/remove only with explicit product-owner approval.
export const ANALYSIS_PAGE_LIMIT = 4

export function analysisLimitMessage(
  totalPages: number,
  analyzedPages: number,
) {
  return `Analiza jest tymczasowo ograniczona do pierwszych ${ANALYSIS_PAGE_LIMIT} stron. Dokument ma ${totalPages} stron; odczytano lokalnie ${analyzedPages}.`
}
