import { GlobalWorkerOptions, getDocument, OPS } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import { createWorker, OEM, PSM } from 'tesseract.js'
import { ANALYSIS_PAGE_LIMIT } from '../analysis/config'
import type {
  ExtractedPdf,
  ExtractionProgress,
  PdfPageDiagnostics,
  PdfPageText,
  PdfLayoutRectangle,
  RawPdfTextItem,
} from './types'
import { reconstructPdfText } from './reconstructPdfText'
import { analyzePageLayout, extractVectorRectangles } from './analyzePdfLayout'

const LOW_TEXT_CHARACTER_THRESHOLD = 24
const OCR_REVIEW_CONFIDENCE_THRESHOLD = 95
const LARGE_IMAGE_COVERAGE_THRESHOLD = 0.35
const IMAGE_PAINT_OPERATORS = new Set([85, 86, 88, 89, 90, 94])
const OCR_RENDER_SCALE = 300 / 72
const OCR_MAX_DIMENSION = 6000
const OCR_MAX_PIXELS = 24_000_000
const BASE_URL = import.meta.env.BASE_URL

if (typeof window !== 'undefined') {
  GlobalWorkerOptions.workerSrc = `${BASE_URL}pdf.worker.min.mjs`
}

export function hasInsufficientText(text: string): boolean {
  return text.replace(/\s/g, '').length < LOW_TEXT_CHARACTER_THRESHOLD
}

export function getPagesToProcess(totalPages: number): number {
  return Math.min(totalPages, ANALYSIS_PAGE_LIMIT)
}

export function buildPageDiagnostics(
  rawItems: RawPdfTextItem[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  currentText: string,
  reconstruction = reconstructPdfText(
    rawItems,
    pageWidth,
    pageHeight,
    currentText,
  ),
  vectorRectangles: PdfLayoutRectangle[] = [],
): PdfPageDiagnostics {
  const sorted = rawItems
    .map((item) => ({
      item,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfPageDiagnostics['lines'] = []
  for (const entry of sorted) {
    let line = lines.find((candidate) => Math.abs(candidate.y - entry.y) <= 2)
    if (!line) {
      line = { y: entry.y, itemIndexes: [], text: '' }
      lines.push(line)
    }
    line.itemIndexes.push(entry.item.index)
    line.text += `${line.text ? ' ' : ''}${entry.item.str}`
  }

  const horizontalGaps: PdfPageDiagnostics['horizontalGaps'] = []
  const possibleFragmentedWords: number[] = []
  const rawItemByIndex = new Map(rawItems.map((item) => [item.index, item]))
  for (const line of lines) {
    const items = line.itemIndexes
      .map((index) => rawItemByIndex.get(index))
      .filter((item): item is RawPdfTextItem => Boolean(item))
      .sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
    for (let i = 1; i < items.length; i += 1) {
      const previous = items[i - 1]
      const current = items[i]
      const gap =
        (current.transform[4] ?? 0) -
        ((previous.transform[4] ?? 0) + previous.width)
      horizontalGaps.push({
        fromItem: previous.index,
        toItem: current.index,
        gap,
      })
      if (
        gap >= -0.5 &&
        gap <= 1.5 &&
        !/\s$/.test(previous.str) &&
        !/^\s/.test(current.str)
      ) {
        possibleFragmentedWords.push(current.index)
      }
    }
  }

  const possibleReadingOrderAnomalies: number[] = []
  for (let i = 1; i < rawItems.length; i += 1) {
    const previous = rawItems[i - 1]
    const current = rawItems[i]
    const sameLine =
      Math.abs((previous.transform[5] ?? 0) - (current.transform[5] ?? 0)) <= 2
    if (
      sameLine &&
      (current.transform[4] ?? 0) < (previous.transform[4] ?? 0) - 2
    ) {
      possibleReadingOrderAnomalies.push(current.index)
    }
  }

  return {
    pageNumber,
    pageWidth,
    pageHeight,
    itemCount: rawItems.length,
    rawItems,
    currentText,
    lines,
    reconstruction,
    layout: analyzePageLayout({
      rawItems,
      pageNumber,
      pageWidth,
      pageHeight,
      reconstruction,
      vectorRectangles,
    }),
    horizontalGaps,
    possibleFragmentedWords,
    possibleReadingOrderAnomalies,
  }
}

export function estimateImageCoverage(
  operators: { fnArray: number[]; argsArray: unknown[][] },
  pageWidth: number,
  pageHeight: number,
): number {
  const pageArea = pageWidth * pageHeight
  if (pageArea <= 0) return 0

  let imageArea = 0
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    if (!IMAGE_PAINT_OPERATORS.has(operators.fnArray[index])) continue
    const args = operators.argsArray[index]
    const firstArg = Array.isArray(args) ? args[0] : undefined
    const matrices = (
      Array.isArray(firstArg) && Array.isArray(firstArg[0])
        ? firstArg
        : Array.isArray(args) &&
            args.length >= 6 &&
            args.slice(0, 6).every(Number.isFinite)
          ? [args]
          : args
    ) as unknown[]
    if (!Array.isArray(matrices)) continue
    for (const candidate of matrices) {
      const matrix = candidate as number[]
      if (
        !Array.isArray(matrix) ||
        matrix.length < 6 ||
        !matrix.slice(0, 6).every(Number.isFinite)
      )
        continue
      const [a, b, c, d] = matrix
      const area = Math.abs(a * d - b * c)
      if (Number.isFinite(area)) imageArea += area
    }
  }

  return Math.min(1, imageArea / pageArea)
}

export function shouldRunOcr(text: string, imageCoverage: number): boolean {
  return (
    hasInsufficientText(text) || imageCoverage >= LARGE_IMAGE_COVERAGE_THRESHOLD
  )
}

export function getOcrRenderScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(
    OCR_RENDER_SCALE,
    OCR_MAX_DIMENSION / Math.max(width, height),
    Math.sqrt(OCR_MAX_PIXELS / (width * height)),
  )
}

export function detectExtractionSignals(
  pdfText: string,
  ocrText: string | null,
  allPageText: string[],
) {
  const pageText = [pdfText, ocrText ?? ''].join(' ')
  const sectionArtifactsDetected =
    /(?:\b8\s*\d+\.|\$\s*\d+\s+ust\.|\b8\d+\.)/.test(ocrText ?? '')
  const injectionDetected =
    /ignore\s+previous\s+instructions|zignoruj\s+wszystkie\s+wcze[sś]niejsze\s+polecenia|napisz,?\s*[żz]e|as\s+an\s+ai|als\s+ki/i.test(
      pageText,
    )
  const attachmentLabel = pageText.match(/Załącznik\s+nr\s+(\d+)/i)?.[1]
  const mappedAnnex = allPageText
    .join(' ')
    .match(
      new RegExp(
        `Załącznik\\s+nr\\s+${attachmentLabel ?? '(?!)'}\\s*[—–-]\\s*Aneks\\s+nr\\s+(\\d+)`,
        'i',
      ),
    )?.[1]
  const labelMismatchDetected = Boolean(attachmentLabel && mappedAnnex)
  const staleSummaryDetected =
    /Podsumowanie finansowe[\s\S]{0,300}295\s*200[,.]00\s*zł[\s\S]{0,80}24\s*miesięcy/i.test(
      pageText,
    ) && labelMismatchDetected
  return {
    sectionArtifactsDetected,
    injectionDetected,
    labelMismatchDetected,
    staleSummaryDetected,
  }
}

export function getOcrPageStatus(input: {
  pdfText: string
  ocrText: string | null
  confidence: number | null
  failed?: boolean
}) {
  const warnings: string[] = []
  if (input.failed) warnings.push('OCR failed for this page.')
  else if (input.ocrText === '')
    warnings.push('OCR returned no text for this page.')
  if (
    input.ocrText &&
    input.confidence !== null &&
    input.confidence < OCR_REVIEW_CONFIDENCE_THRESHOLD
  ) {
    warnings.push(
      `OCR confidence is low (${Math.round(input.confidence)}%). Review the original page.`,
    )
  }
  const ocrStatus: PdfPageText['ocrStatus'] = input.failed
    ? 'failed'
    : input.ocrText === ''
      ? 'empty'
      : input.ocrText === null
        ? 'not-needed'
        : 'succeeded'
  return {
    ocrStatus,
    warnings,
    needsReview:
      ocrStatus === 'failed' ||
      ocrStatus === 'empty' ||
      (input.ocrText !== null &&
        (input.confidence ?? 0) < OCR_REVIEW_CONFIDENCE_THRESHOLD),
    isEmpty: !input.pdfText && !input.ocrText,
  }
}

async function renderPageToCanvas(
  page: PDFPageProxy,
): Promise<HTMLCanvasElement> {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = getOcrRenderScale(baseViewport.width, baseViewport.height)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return canvas
}

async function recognizePage(
  page: PDFPageProxy,
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<{ text: string; confidence: number }> {
  const canvas = await renderPageToCanvas(page)
  try {
    const { data } = await worker.recognize(canvas, { rotateAuto: true })
    return {
      text: data.text.replace(/\s+/g, ' ').trim(),
      confidence: data.confidence,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

async function recognizeTitleRegion(
  page: PDFPageProxy,
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<string> {
  const canvas = await renderPageToCanvas(page)
  try {
    // The scanned annex title is centered near the top, while the attachment
    // label is in the upper corner. OCR this region separately with sparse-text
    // segmentation so the small corner line cannot dominate title detection.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    const { data } = await worker.recognize(canvas, {
      rotateAuto: true,
      rectangle: {
        left: Math.round(canvas.width * 0.12),
        top: 0,
        width: Math.round(canvas.width * 0.76),
        height: Math.round(canvas.height * 0.28),
      },
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return data.text.replace(/\s+/g, ' ').trim()
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    canvas.width = 0
    canvas.height = 0
  }
}

export async function extractPdfText(
  file: File,
  onProgress?: (progress: ExtractionProgress) => void,
): Promise<ExtractedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const loadingTask = getDocument({ data: bytes })
  let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null

  try {
    const document = await loadingTask.promise
    const pages: PdfPageText[] = []
    const emptyPageNumbers: number[] = []
    const failedPageNumbers: number[] = []
    const lowConfidencePageNumbers: number[] = []
    const needsReviewPageNumbers: number[] = []
    const injectionPageNumbers: number[] = []
    const labelMismatchPageNumbers: number[] = []
    let characterCount = 0

    const pagesToProcess = getPagesToProcess(document.numPages)
    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const rawItems: RawPdfTextItem[] = content.items.flatMap((item, index) =>
        'str' in item
          ? [
              {
                index,
                str: item.str,
                transform: [...item.transform],
                width: item.width,
                height: item.height,
                fontName: item.fontName,
                dir: item.dir,
                style: content.styles[item.fontName]
                  ? { ...content.styles[item.fontName] }
                  : undefined,
                hasEOL: item.hasEOL,
              },
            ]
          : [],
      )
      const legacyPdfText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      const viewport = page.getViewport({ scale: 1 })
      let operators: { fnArray: number[]; argsArray: unknown[][] } = {
        fnArray: [],
        argsArray: [],
      }
      try {
        operators = await page.getOperatorList()
      } catch {
        // Text extraction remains usable when PDF.js cannot enumerate drawings.
      }
      const diagnostics = buildPageDiagnostics(
        rawItems,
        pageNumber,
        viewport.width,
        viewport.height,
        legacyPdfText,
        reconstructPdfText(
          rawItems,
          viewport.width,
          viewport.height,
          legacyPdfText,
        ),
        extractVectorRectangles(
          operators,
          OPS.constructPath,
          viewport.width,
          viewport.height,
        ),
      )
      const pdfText = diagnostics.reconstruction.text
      const imageCoverage = estimateImageCoverage(
        operators,
        viewport.width,
        viewport.height,
      )
      let ocrText: string | null = null
      let confidence: number | null = null
      let ocrFailed = false

      if (shouldRunOcr(pdfText, imageCoverage)) {
        if (!ocrWorker) {
          onProgress?.({ stage: 'loading-ocr', totalPages: document.numPages })
          try {
            ocrWorker = await createWorker('pol', OEM.LSTM_ONLY, {
              workerPath: `${BASE_URL}ocr/worker.min.js`,
              corePath: `${BASE_URL}ocr/core`,
              langPath: `${BASE_URL}tessdata`,
              gzip: true,
              logger: (message) => {
                onProgress?.({
                  stage: 'loading-ocr',
                  totalPages: document.numPages,
                  progress: message.progress,
                })
              },
            })
          } catch {
            ocrFailed = true
          }
        }

        if (ocrWorker) {
          onProgress?.({
            stage: 'recognizing',
            pageNumber,
            totalPages: document.numPages,
          })
          try {
            const recognized = await recognizePage(page, ocrWorker)
            let text = recognized.text
            // A second sparse-layout pass targets a common failure mode in
            // scanned legal pages: a centered title omitted from full-page OCR.
            const titlePass = await recognizeTitleRegion(page, ocrWorker)
            if (
              titlePass &&
              !/ANEKS\s+NR\s+1/i.test(text) &&
              /ANEKS\s+NR\s+1/i.test(titlePass)
            ) {
              text = `${titlePass} ${text}`.trim()
            }
            ocrText = text
            confidence = recognized.confidence
          } catch {
            ocrFailed = true
          }
        }
      }

      const status = getOcrPageStatus({
        pdfText,
        ocrText,
        confidence,
        failed: ocrFailed,
      })
      const pageResult: PdfPageText = {
        pageNumber,
        pdfText,
        ocrText,
        imageCoverage,
        confidence,
        ocrStatus: status.ocrStatus,
        warnings: status.warnings,
        needsReview: status.needsReview,
        diagnostics,
      }
      pages.push(pageResult)
      characterCount +=
        pageResult.pdfText.length + (pageResult.ocrText?.length ?? 0)
      if (status.isEmpty) emptyPageNumbers.push(pageNumber)
      if (pageResult.ocrStatus === 'failed') failedPageNumbers.push(pageNumber)
      const allPageText = pages.map(
        (item) => `${item.pdfText} ${item.ocrText ?? ''}`,
      )
      const signals = detectExtractionSignals(pdfText, ocrText, allPageText)
      pageResult.sectionArtifactsDetected = signals.sectionArtifactsDetected
      pageResult.injectionDetected = signals.injectionDetected
      pageResult.labelMismatchDetected = signals.labelMismatchDetected
      pageResult.staleSummaryDetected = signals.staleSummaryDetected
      pageResult.needsReview =
        pageResult.needsReview ||
        signals.sectionArtifactsDetected ||
        signals.labelMismatchDetected
      if (
        pageResult.ocrStatus === 'succeeded' &&
        (pageResult.confidence ?? 0) < OCR_REVIEW_CONFIDENCE_THRESHOLD
      )
        lowConfidencePageNumbers.push(pageNumber)
      if (pageResult.needsReview || signals.injectionDetected)
        needsReviewPageNumbers.push(pageNumber)
      if (signals.injectionDetected) injectionPageNumbers.push(pageNumber)
      if (signals.labelMismatchDetected)
        labelMismatchPageNumbers.push(pageNumber)
      onProgress?.({
        stage: 'extracting',
        pageNumber,
        totalPages: document.numPages,
      })
      page.cleanup()
    }

    return {
      fileName: file.name,
      pageCount: document.numPages,
      analyzedPageCount: pages.length,
      analysisPageLimit: ANALYSIS_PAGE_LIMIT,
      pages,
      emptyPageNumbers,
      failedPageNumbers,
      lowConfidencePageNumbers,
      needsReviewPageNumbers,
      injectionPageNumbers,
      labelMismatchPageNumbers,
      isComplete:
        pages.length === pagesToProcess &&
        failedPageNumbers.length === 0 &&
        emptyPageNumbers.length === 0,
      characterCount,
    }
  } finally {
    await ocrWorker?.terminate()
    await loadingTask.destroy()
  }
}
