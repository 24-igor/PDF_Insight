import { AnalysisResultValidator, AnalyzeRequestSchema } from './schema'
import type { ExtractedPdf } from '../pdf/types'
import { ANALYSIS_PAGE_LIMIT, ANALYSIS_SCOPE } from './config'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787'

export function selectAnalysisPages(extracted: ExtractedPdf) {
  const scopedPages =
    ANALYSIS_SCOPE === 'first-page'
      ? extracted.pages.slice(0, 1)
      : extracted.pages
  return scopedPages.slice(0, ANALYSIS_PAGE_LIMIT)
}

export async function analyzePdf(extracted: ExtractedPdf) {
  const pages = selectAnalysisPages(extracted)
  const request = AnalyzeRequestSchema.safeParse({
    fileName: extracted.fileName,
    pageCount: pages.length,
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.ocrText ?? page.pdfText,
      extractionMethod: page.ocrText !== null ? 'ocr' : 'pdfjs',
      confidence: page.ocrText !== null ? page.confidence : null,
    })),
  })
  if (!request.success) {
    throw new Error('Dokument zawiera zbyt dużo tekstu do analizy.')
  }

  let response: Response
  try {
    response = await fetch(`${API_URL.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.data),
    })
  } catch {
    throw new Error(
      'Nie można połączyć się z lokalnym Workerem. Uruchom npm run worker:dev.',
    )
  }

  let responseBody: unknown
  try {
    responseBody = await response.json()
  } catch {
    throw new Error('Worker zwrócił nieprawidłową odpowiedź.')
  }

  if (!response.ok) {
    const message =
      responseBody &&
      typeof responseBody === 'object' &&
      'error' in responseBody &&
      typeof responseBody.error === 'string'
        ? responseBody.error
        : 'Analiza dokumentu nie powiodła się.'
    throw new Error(message)
  }

  const result = AnalysisResultValidator.safeParse(responseBody)
  if (!result.success) {
    throw new Error('Odpowiedź analizy nie spełnia wymaganego schematu.')
  }
  return result.data
}
