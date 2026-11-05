import { describe, expect, it } from 'vitest'
import { buildAnalyzeRequest, selectAnalysisPages } from './analyzePdf'
import { analysisLimitMessage } from './config'
import type { ExtractedPdf } from '../pdf/types'

function makeExtracted(pageCount: number): ExtractedPdf {
  return {
    fileName: 'sample.pdf',
    pageCount,
    analyzedPageCount: pageCount,
    analysisPageLimit: 4,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      pdfText: `Page ${index + 1}`,
      ocrText: null,
      imageCoverage: 0,
      ocrStatus: 'not-needed' as const,
      confidence: null,
      warnings: [],
      needsReview: false,
    })),
    emptyPageNumbers: [],
    failedPageNumbers: [],
    lowConfidencePageNumbers: [],
    needsReviewPageNumbers: [],
    injectionPageNumbers: [],
    labelMismatchPageNumbers: [],
    isComplete: true,
    characterCount: pageCount * 6,
  }
}

describe('temporary analysis page limit', () => {
  it('selects all four pages from a four-page PDF', () => {
    expect(
      selectAnalysisPages(makeExtracted(4)).map((page) => page.pageNumber),
    ).toEqual([1, 2, 3, 4])
  })

  it('selects only pages 1–4 from a longer PDF', () => {
    const selected = selectAnalysisPages(makeExtracted(12))
    expect(selected).toHaveLength(4)
    expect(selected.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4])
    expect(selected.some((page) => page.pageNumber >= 5)).toBe(false)
  })

  it('preserves source page numbers for evidence metadata', () => {
    expect(
      selectAnalysisPages(makeExtracted(12)).map((page) => page.pageNumber),
    ).toEqual([1, 2, 3, 4])
  })

  it('preserves the original document page count in the request', () => {
    const request = buildAnalyzeRequest(makeExtracted(12))
    expect(request.pageCount).toBe(12)
    expect(request.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4])
  })

  it('provides the UI disclosure for documents over the limit', () => {
    expect(analysisLimitMessage(12, 4)).toContain('pierwszych 4 stron')
    expect(analysisLimitMessage(12, 4)).toContain('Dokument ma 12 stron')
  })
})
