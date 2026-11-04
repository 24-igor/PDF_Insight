import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OPS } from 'pdfjs-dist'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { ExtractedPdf, RawPdfTextItem } from './types'
import { analyzePageLayout, extractVectorRectangles } from './analyzePdfLayout'
import { reconstructPdfText } from './reconstructPdfText'
import { createStructuredDocument } from './structuredDocument'

function makeItem(
  index: number,
  str: string,
  x: number,
  y: number,
  width: number,
  fontSize = 10,
  hasEOL = false,
): RawPdfTextItem {
  return {
    index,
    str,
    transform: [fontSize, 0, 0, fontSize, x, y],
    width,
    height: fontSize,
    fontName: 'F1',
    hasEOL,
  }
}

function analyze(rawItems: RawPdfTextItem[], pageNumber = 1) {
  const pageWidth = 600
  const pageHeight = 800
  return analyzePageLayout({
    rawItems,
    pageNumber,
    pageWidth,
    pageHeight,
    reconstruction: reconstructPdfText(rawItems, pageWidth, pageHeight),
  })
}

describe('analyzePageLayout', () => {
  it('groups geometry into candidate headings, paragraphs, and page furniture', () => {
    const layout = analyze([
      makeItem(0, 'DOCUMENT TITLE', 40, 750, 140, 18),
      makeItem(1, 'First paragraph line', 40, 710, 150),
      makeItem(2, 'Second paragraph line', 40, 696, 155),
      makeItem(3, 'Page 1', 500, 16, 35),
    ])

    expect(layout.blocks.map((block) => block.type)).toContain(
      'heading_candidate',
    )
    expect(layout.blocks.map((block) => block.type)).toContain('paragraph')
    expect(layout.blocks.map((block) => block.type)).toContain(
      'footer_candidate',
    )
  })

  it('marks repeated aligned rows as a low-confidence table candidate', () => {
    const items = Array.from({ length: 4 }, (_, row) => {
      const y = 700 - row * 18
      return [
        makeItem(row * 3, `Stage${row}`, 40, y, 45),
        makeItem(row * 3 + 1, `Scope${row}`, 180, y, 55),
        makeItem(row * 3 + 2, `Date${row}`, 350, y, 40),
      ]
    }).flat()
    const layout = analyze(items)

    expect(
      layout.blocks.some((block) => block.type === 'table_candidate'),
    ).toBe(true)
    expect(
      layout.blocks.find((block) => block.type === 'table_candidate')
        ?.confidence,
    ).toBe('low')
  })
})

describe('layout preview against the supplied Polish contract', () => {
  let loadingTask: PDFDocumentLoadingTask
  let pdf: PDFDocumentProxy

  beforeAll(async () => {
    const path = fileURLToPath(
      new URL(
        '../../../SRC_DATA/Test_PDF_Insight_umowa_14-2026.pdf',
        import.meta.url,
      ),
    )
    loadingTask = getDocument({ data: new Uint8Array(await readFile(path)) })
    pdf = await loadingTask.promise
  })

  afterAll(async () => {
    await loadingTask?.destroy()
  })

  it('creates a diagnostic block preview without losing any raw item references', async () => {
    for (const pageNumber of [1, 3, 4, 5, 6, 7, 8, 10]) {
      const page = await pdf.getPage(pageNumber)
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
      const viewport = page.getViewport({ scale: 1 })
      const reconstruction = reconstructPdfText(
        rawItems,
        viewport.width,
        viewport.height,
      )
      const operators = await page.getOperatorList()
      const vectorRectangles = extractVectorRectangles(
        operators,
        OPS.constructPath,
        viewport.width,
        viewport.height,
      )
      const layout = analyzePageLayout({
        rawItems,
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        reconstruction,
        vectorRectangles,
      })
      const referencedIndexes = layout.blocks.flatMap((block) =>
        block.lines.flatMap((line) => line.itemIndexes),
      )

      expect(layout.blocks.length, `page ${pageNumber}`).toBeGreaterThan(0)
      expect(
        referencedIndexes.sort((a, b) => a - b),
        `page ${pageNumber}`,
      ).toEqual(
        rawItems
          .filter((item) => item.str.trim())
          .map((item) => item.index)
          .sort((a, b) => a - b),
      )
      if (pageNumber === 6) {
        expect(layout.layoutKind).toBe('multi-column')
        expect(layout.columns).toHaveLength(2)
        const leftColumnBlocks = layout.blocks.filter(
          (block) => block.columnIndex === 0,
        )
        const rightColumnBlocks = layout.blocks.filter(
          (block) => block.columnIndex === 1,
        )
        expect(leftColumnBlocks.at(-1)?.id).not.toBeUndefined()
        expect(rightColumnBlocks[0]?.id).not.toBeUndefined()
        expect(layout.blocks.indexOf(leftColumnBlocks.at(-1)!)).toBeLessThan(
          layout.blocks.indexOf(rightColumnBlocks[0]),
        )
        expect(reconstruction.text.indexOf('§ 7')).toBeLessThan(
          reconstruction.text.indexOf('§ 9'),
        )
      }
      if (pageNumber === 1) {
        expect(
          layout.blocks.some((block) => block.type === 'card_candidate'),
        ).toBe(true)
        expect(
          layout.blocks.some((block) => block.type === 'table_candidate'),
        ).toBe(true)
        expect(layout.vectorRectangles.length).toBeGreaterThanOrEqual(2)
        expect(
          layout.blocks.filter((block) => block.type === 'card_candidate'),
        ).toHaveLength(2)
        const extracted: ExtractedPdf = {
          fileName: 'Test_PDF_Insight_umowa_14-2026.pdf',
          pageCount: 1,
          pages: [
            {
              pageNumber,
              pdfText: reconstruction.text,
              ocrText: null,
              imageCoverage: 0,
              ocrStatus: 'not-needed',
              confidence: null,
              warnings: [],
              needsReview: false,
              diagnostics: {
                pageNumber,
                pageWidth: viewport.width,
                pageHeight: viewport.height,
                itemCount: rawItems.length,
                rawItems,
                currentText: reconstruction.text,
                lines: [],
                reconstruction,
                layout,
                horizontalGaps: [],
                possibleFragmentedWords: [],
                possibleReadingOrderAnomalies: [],
              },
            },
          ],
          emptyPageNumbers: [],
          failedPageNumbers: [],
          lowConfidencePageNumbers: [],
          needsReviewPageNumbers: [],
          injectionPageNumbers: [],
          labelMismatchPageNumbers: [],
          isComplete: true,
          characterCount: reconstruction.text.length,
        }
        const structured = createStructuredDocument(extracted)
        const companyCards = structured.pages[0].blocks.filter(
          (block) => block.type === 'card',
        )
        expect(companyCards).toHaveLength(2)
        expect(companyCards[0].text).toContain('Nordwave Logistics')
        expect(companyCards[1].text).toContain('Kwadrat Software')
        expect(
          structured.pages[0].readingOrderText.indexOf('Nordwave Logistics'),
        ).toBeLessThan(
          structured.pages[0].readingOrderText.indexOf('Kwadrat Software'),
        )
        expect(
          structured.pages[0].readingOrderText.indexOf('Nordwave Logistics'),
        ).toBeLessThan(
          structured.pages[0].readingOrderText.indexOf('Preambuła'),
        )
        expect(structured.pages[0].markdownText).toContain(
          'Karta 1\n\nNordwave Logistics sp. z o.o.',
        )
        expect(structured.pages[0].markdownText).toContain(
          'ul. Portowa 18, 80-555 Gdańsk',
        )
        expect(structured.pages[0].markdownText).toContain(
          'Karta 2\n\nKwadrat Software S.A.',
        )
        expect(structured.pages[0].markdownText).toContain(
          'ul. Legnicka 48B, 54-202 Wrocław',
        )
        expect(structured.pages[0].markdownText).toContain('Pawła Dąbrowskiego')
        expect(structured.pages[0].markdownText).toContain('Prezes Zarządu')
        expect(structured.pages[0].markdownText).toContain('Część')
        expect(structured.pages[0].markdownText).toContain('Tytuł')
        expect(structured.pages[0].markdownText).not.toContain('Cz | ęść')
        expect(structured.pages[0].markdownText).not.toContain('Tytu | ł')
      }
      if ([3, 4, 6, 7, 8, 10].includes(pageNumber)) {
        const structured = createStructuredDocument({
          fileName: 'Test_PDF_Insight_umowa_14-2026.pdf',
          pageCount: pdf.numPages,
          pages: [
            {
              pageNumber,
              pdfText: reconstruction.text,
              ocrText: null,
              imageCoverage: 0,
              ocrStatus: 'not-needed',
              confidence: null,
              warnings: [],
              needsReview: false,
              diagnostics: {
                pageNumber,
                pageWidth: viewport.width,
                pageHeight: viewport.height,
                itemCount: rawItems.length,
                rawItems,
                currentText: reconstruction.text,
                lines: [],
                reconstruction,
                layout,
                horizontalGaps: [],
                possibleFragmentedWords: [],
                possibleReadingOrderAnomalies: [],
              },
            },
          ],
          emptyPageNumbers: [],
          failedPageNumbers: [],
          lowConfidencePageNumbers: [],
          needsReviewPageNumbers: [],
          injectionPageNumbers: [],
          labelMismatchPageNumbers: [],
          isComplete: true,
          characterCount: reconstruction.text.length,
        }).pages[0]
        expect(structured.markdownText).not.toContain('###')
        if (pageNumber === 3) {
          expect(structured.markdownText).toContain('Udział')
          expect(structured.markdownText).not.toContain('Udzia | ł')
        }
        if (pageNumber === 4) {
          expect(structured.markdownText).toContain(
            'Opóźnienie w realizacji etapu',
          )
          expect(structured.markdownText).toContain('Naruszenie poufności')
          expect(structured.markdownText).toContain('200 000,00 zł')
          expect(structured.markdownText).toContain(
            '0,2% wynagrodzenia za wdrożenie za każdy',
          )
          expect(structured.markdownText).toContain('15 000,00 zł')
          expect(structured.markdownText).toContain('30% abonamentu')
        }
        if (pageNumber === 6) {
          expect(structured.markdownText).toContain('Julia Mazur.')
          expect(structured.markdownText.indexOf('Julia Mazur.')).toBeLessThan(
            structured.markdownText.indexOf('§ 9.'),
          )
          expect(structured.markdownText).not.toMatch(/\nMazur\.\n§ 9\./)
          const sectionOrder = ['§ 7.', '§ 8.', '§ 9.', '§ 10.'].map(
            (section) => structured.markdownText.indexOf(section),
          )
          expect(sectionOrder.every((index) => index >= 0)).toBe(true)
          expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b))
        }
        if (pageNumber === 7) {
          expect(structured.markdownText).toContain('3 200,00 zł')
          expect(structured.markdownText).not.toContain('3 200,00 z | ł')
        }
        if (pageNumber === 8) {
          expect(structured.markdownText).toContain('PO-NW-2026-0311')
          expect(structured.markdownText).toContain(
            'Zaliczka 30% na wdrożenie systemu CRM wg umowy 14/2026 1 55 350,00',
          )
          expect(structured.markdownText).toContain('23% 12 730,50 68 080,50')
        }
        if (pageNumber === 10) {
          expect(structured.markdownText).toContain(
            'Wskaźnik | Stan obecny | Cel po 12 mies. | Zmiana',
          )
          expect(structured.markdownText).toContain(
            'Średni czas odpowiedzi na zapytanie | 26 h | 6 h | −77%',
          )
          expect(structured.markdownText).toContain(
            'Rotacja klientów rocznie (churn) | 9,2% | 6,5% | −2,7 pp',
          )
        }
      }
      if ([3, 5, 7, 8, 10].includes(pageNumber)) {
        expect(
          layout.blocks.some((block) => block.type === 'table_candidate'),
          `page ${pageNumber} should expose a table candidate`,
        ).toBe(true)
      }
    }
  })
})
