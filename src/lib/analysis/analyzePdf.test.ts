import { describe, expect, it } from 'vitest'
import { buildAnalyzeRequest, selectAnalysisPages } from './analyzePdf'
import type { ExtractedPdf } from '../pdf/types'

function makeExtracted(pageCount: number): ExtractedPdf {
  return {
    fileName: 'sample.pdf',
    pageCount,
    analyzedPageCount: pageCount,
    analysisPageLimit: null,
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

describe('full-document analysis scope', () => {
  it('selects all pages from a four-page PDF', () => {
    expect(
      selectAnalysisPages(makeExtracted(4)).map((page) => page.pageNumber),
    ).toEqual([1, 2, 3, 4])
  })

  it('selects all pages from a longer PDF', () => {
    const selected = selectAnalysisPages(makeExtracted(12))
    expect(selected).toHaveLength(12)
    expect(selected.map((page) => page.pageNumber)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
  })

  it('preserves source page numbers for evidence metadata', () => {
    expect(
      selectAnalysisPages(makeExtracted(12)).map((page) => page.pageNumber),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  })

  it('preserves the original document page count in the request', () => {
    const request = buildAnalyzeRequest(makeExtracted(12))
    expect(request.pageCount).toBe(12)
    expect(request.documentPageCount).toBe(12)
    expect(request.pages.map((page) => page.pageNumber)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )
  })
})
