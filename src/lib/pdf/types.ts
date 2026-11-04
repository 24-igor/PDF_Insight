export type PdfPageText = {
  pageNumber: number
  /** Reconstructed PDF text used by the rest of the application. */
  pdfText: string
  ocrText: string | null
  imageCoverage: number
  ocrStatus: 'not-needed' | 'succeeded' | 'empty' | 'failed'
  confidence: number | null
  warnings: string[]
  needsReview: boolean
  sectionArtifactsDetected?: boolean
  injectionDetected?: boolean
  labelMismatchDetected?: boolean
  staleSummaryDetected?: boolean
  diagnostics?: PdfPageDiagnostics
}

export type RawPdfTextItem = {
  index: number
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
  dir?: string
  style?: {
    fontFamily?: string
    ascent?: number
    descent?: number
    vertical?: boolean
  }
  hasEOL: boolean
}

export type PdfPageDiagnostics = {
  pageNumber: number
  pageWidth: number
  pageHeight: number
  itemCount: number
  rawItems: RawPdfTextItem[]
  currentText: string
  lines: Array<{ y: number; itemIndexes: number[]; text: string }>
  reconstruction: PdfTextReconstruction
  layout: PdfPageLayout
  horizontalGaps: Array<{ fromItem: number; toItem: number; gap: number }>
  possibleFragmentedWords: number[]
  possibleReadingOrderAnomalies: number[]
}

export type PdfLayoutBlockType =
  | 'heading_candidate'
  | 'paragraph'
  | 'table_candidate'
  | 'card_candidate'
  | 'header_candidate'
  | 'footer_candidate'

export type PdfLayoutLine = {
  lineNumber: number
  columnIndex: number | null
  y: number
  bounds: { x: number; y: number; width: number; height: number }
  text: string
  itemIndexes: number[]
  fontSize: number
}

export type PdfLayoutBlock = {
  id: string
  type: PdfLayoutBlockType
  confidence: 'low' | 'medium'
  reason: string
  columnIndex: number | null
  bounds: { x: number; y: number; width: number; height: number }
  lines: PdfLayoutLine[]
}

export type PdfPageLayout = {
  pageNumber: number
  width: number
  height: number
  layoutKind: 'single-column' | 'multi-column' | 'uncertain'
  columnCount: number | null
  columns: Array<{
    index: number
    xStart: number
    xEnd: number
    blockIds: string[]
  }>
  vectorRectangles: PdfLayoutRectangle[]
  blocks: PdfLayoutBlock[]
}

export type PdfLayoutRectangle = {
  x: number
  y: number
  width: number
  height: number
}

export type ReconstructedLine = {
  y: number
  itemIndexes: number[]
  text: string
  runs: string[]
  usedItemOrderFallback: boolean
}

export type PdfTextReconstruction = {
  text: string
  lines: ReconstructedLine[]
  insertedSpaces: Array<{
    afterItem: number
    beforeItem: number
    gap: number
  }>
  joinedFragments: Array<{
    afterItem: number
    beforeItem: number
    gap: number
  }>
  warnings: string[]
  isMultiColumn: boolean
  usedPdfJsItemOrderFallback: boolean
  columnSplitX?: number
}

export type ExtractedPdf = {
  fileName: string
  pageCount: number
  analyzedPageCount?: number
  analysisPageLimit?: number
  pages: PdfPageText[]
  emptyPageNumbers: number[]
  failedPageNumbers: number[]
  lowConfidencePageNumbers: number[]
  needsReviewPageNumbers: number[]
  injectionPageNumbers: number[]
  labelMismatchPageNumbers: number[]
  isComplete: boolean
  characterCount: number
}

export type ExtractionProgress = {
  stage: 'extracting' | 'loading-ocr' | 'recognizing'
  pageNumber?: number
  totalPages: number
  progress?: number
}

export type PdfValidationError =
  'wrong-type' | 'too-large' | 'invalid-signature'

export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024
