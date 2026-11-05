export type AnalysisScope = 'first-page' | 'full-document'

// Full-document analysis is enabled. Set this to a finite number only for an
// explicitly approved temporary test cap.
export const ANALYSIS_SCOPE: AnalysisScope = 'full-document'

export const ANALYSIS_PAGE_LIMIT: number | null = null

export function analysisLimitMessage(
  totalPages: number,
  analyzedPages: number,
) {
  if (ANALYSIS_PAGE_LIMIT === null) return ''
  return `Analiza jest tymczasowo ograniczona do pierwszych ${ANALYSIS_PAGE_LIMIT} stron. Dokument ma ${totalPages} stron; odczytano lokalnie ${analyzedPages}.`
}
