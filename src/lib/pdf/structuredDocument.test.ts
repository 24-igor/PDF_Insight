import { describe, expect, it } from 'vitest'
import type {
  ExtractedPdf,
  PdfLayoutBlock,
  PdfPageLayout,
  RawPdfTextItem,
} from './types'
import { createStructuredDocument } from './structuredDocument'

function makeItem(
  index: number,
  str: string,
  x: number,
  y: number,
): RawPdfTextItem {
  return {
    index,
    str,
    transform: [10, 0, 0, 10, x, y],
    width: str.length * 5,
    height: 10,
    fontName: 'F1',
    hasEOL: false,
  }
}

function makeBlock(
  id: string,
  type: PdfLayoutBlock['type'],
  lineSpecs: Array<{
    text: string
    itemIndexes: number[]
    x: number
    y: number
  }>,
  columnIndex: number | null = null,
): PdfLayoutBlock {
  const lines = lineSpecs.map((line, index) => ({
    lineNumber: index + 1,
    columnIndex,
    y: line.y,
    bounds: { x: line.x, y: line.y, width: 100, height: 10 },
    text: line.text,
    itemIndexes: line.itemIndexes,
    fontSize: 10,
  }))
  return {
    id,
    type,
    confidence: 'medium',
    reason: 'Test fixture classification.',
    columnIndex,
    bounds: { x: 10, y: 10, width: 200, height: 30 },
    lines,
  }
}

function makeExtractedPdf(input: {
  blocks?: PdfLayoutBlock[]
  rawItems?: RawPdfTextItem[]
  layoutKind?: PdfPageLayout['layoutKind']
  columns?: PdfPageLayout['columns']
  pdfText?: string
  ocrText?: string | null
  confidence?: number | null
  needsReview?: boolean
}): ExtractedPdf {
  const rawItems = input.rawItems ?? []
  const blocks = input.blocks ?? []
  const layout: PdfPageLayout = {
    pageNumber: 1,
    width: 600,
    height: 800,
    layoutKind: input.layoutKind ?? 'single-column',
    columnCount: input.layoutKind === 'multi-column' ? 2 : 1,
    columns: input.columns ?? [],
    vectorRectangles: [],
    blocks,
  }
  return {
    fileName: 'sample.pdf',
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        pdfText: input.pdfText ?? '',
        ocrText: input.ocrText ?? null,
        imageCoverage: 0,
        ocrStatus: input.ocrText ? 'succeeded' : 'not-needed',
        confidence: input.confidence ?? null,
        warnings: [],
        needsReview: input.needsReview ?? false,
        diagnostics: {
          pageNumber: 1,
          pageWidth: 600,
          pageHeight: 800,
          itemCount: rawItems.length,
          rawItems,
          currentText: input.pdfText ?? '',
          lines: [],
          reconstruction: {
            text: input.pdfText ?? '',
            lines: [],
            insertedSpaces: [],
            joinedFragments: [],
            warnings: [],
            isMultiColumn: input.layoutKind === 'multi-column',
            usedPdfJsItemOrderFallback: false,
          },
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
    characterCount: 0,
  }
}

describe('createStructuredDocument', () => {
  it('preserves table rows, cell positions, and raw source item references', () => {
    const rawItems = [
      makeItem(0, 'Role', 20, 100),
      makeItem(1, 'Count', 220, 100),
      makeItem(2, 'Users', 20, 80),
      makeItem(3, '135', 220, 80),
    ]
    const table = makeBlock('block-1', 'table_candidate', [
      { text: 'Role Count', itemIndexes: [0, 1], x: 20, y: 100 },
      { text: 'Users 135', itemIndexes: [2, 3], x: 20, y: 80 },
    ])
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [table],
        rawItems,
        pdfText: 'Role Count Users 135',
      }),
    )

    expect(document.pages[0].blocks[0]).toMatchObject({
      type: 'table',
      rows: [
        { cells: [{ text: 'Role' }, { text: 'Count' }] },
        { cells: [{ text: 'Users' }, { text: '135' }] },
      ],
    })
    expect(document.pages[0].rawItems).toEqual(rawItems)
    expect(document.pages[0].sourceText).toEqual({
      pdfjs: 'Role Count Users 135',
      ocr: null,
    })
    expect(document.pages[0].blocks[0].source.itemIndexes).toEqual([0, 1, 2, 3])
  })

  it('joins touching PDF.js fragments inside table cells and preserves cell gaps', () => {
    const rawItems = [
      makeItem(0, 'Zarz', 20, 100),
      makeItem(1, 'ą', 40, 100),
      makeItem(2, 'du', 45, 100),
      makeItem(3, 'Fee', 200, 100),
      makeItem(4, 'Gda', 20, 80),
      makeItem(5, 'ń', 35, 80),
      makeItem(6, 'sk', 40, 80),
      makeItem(7, 'City', 200, 80),
      makeItem(8, 'Paw', 20, 60),
      makeItem(9, 'ł', 35, 60),
      makeItem(10, 'a D', 40, 60),
      makeItem(11, 'ą', 55, 60),
      makeItem(12, 'browski', 60, 60),
      makeItem(13, 'Name', 200, 60),
      makeItem(14, 'Wiceprezes', 20, 40),
      makeItem(15, 'Zarządu', 73, 40),
      makeItem(16, 'Role', 200, 40),
    ]
    const table = makeBlock('table-fragments', 'table_candidate', [
      { text: 'Zarządu Fee', itemIndexes: [0, 1, 2, 3], x: 20, y: 100 },
      { text: 'Gdańsk City', itemIndexes: [4, 5, 6, 7], x: 20, y: 80 },
      {
        text: 'Pawła Dąbrowski Name',
        itemIndexes: [8, 9, 10, 11, 12, 13],
        x: 20,
        y: 60,
      },
      {
        text: 'Wiceprezes Zarządu Role',
        itemIndexes: [14, 15, 16],
        x: 20,
        y: 40,
      },
    ])
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [table],
        rawItems,
        pdfText: 'table text',
      }),
    )

    expect(
      document.pages[0].blocks[0].rows?.map((row) =>
        row.cells.map((cell) => cell.text),
      ),
    ).toEqual([
      ['Zarządu', 'Fee'],
      ['Gdańsk', 'City'],
      ['Pawła Dąbrowski', 'Name'],
      ['Wiceprezes Zarządu', 'Role'],
    ])
    expect(document.pages[0].markdownText).toContain('- Zarządu | Fee')
    expect(document.pages[0].markdownText).toContain('- Gdańsk | City')
    expect(document.pages[0].markdownText).not.toContain('Zarz | ądu')
  })

  it('keeps paired cards as independent ordered fields', () => {
    const rawItems = [
      makeItem(0, 'Nordwave', 20, 100),
      makeItem(1, 'Gdansk', 20, 80),
    ]
    const card = makeBlock('card-1', 'card_candidate', [
      { text: 'Nordwave', itemIndexes: [0], x: 20, y: 100 },
      { text: 'Gdansk', itemIndexes: [1], x: 20, y: 80 },
    ])
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [card],
        rawItems,
        pdfText: 'Nordwave Gdansk',
      }),
    )

    expect(document.pages[0].blocks[0]).toMatchObject({
      type: 'card',
      fields: [
        { order: 0, text: 'Nordwave' },
        { order: 1, text: 'Gdansk' },
      ],
    })
  })

  it('builds simple text in block order with visible separation between cards', () => {
    const firstCard = makeBlock('card-1', 'card_candidate', [
      {
        text: 'Nordwave Logistics sp. z o.o.',
        itemIndexes: [0],
        x: 20,
        y: 700,
      },
      { text: 'zwaną dalej „Zamawiającym”', itemIndexes: [1], x: 20, y: 680 },
    ])
    firstCard.bounds = { x: 20, y: 680, width: 200, height: 30 }
    const secondCard = makeBlock('card-2', 'card_candidate', [
      { text: 'Kwadrat Software S.A.', itemIndexes: [2], x: 320, y: 700 },
      { text: 'zwaną dalej „Wykonawcą”', itemIndexes: [3], x: 320, y: 680 },
    ])
    secondCard.bounds = { x: 320, y: 680, width: 200, height: 30 }
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [secondCard, firstCard],
        rawItems: [
          makeItem(0, 'Nordwave Logistics sp. z o.o.', 20, 700),
          makeItem(1, 'zwaną dalej „Zamawiającym”', 20, 680),
          makeItem(2, 'Kwadrat Software S.A.', 320, 700),
          makeItem(3, 'zwaną dalej „Wykonawcą”', 320, 680),
        ],
        pdfText: 'combined source text',
      }),
    )

    expect(document.pages[0].readingOrderText).toBe(
      'Nordwave Logistics sp. z o.o.\nzwaną dalej „Zamawiającym”\n\nKwadrat Software S.A.\nzwaną dalej „Wykonawcą”',
    )
    expect(document.readingOrderText).toBe(document.pages[0].readingOrderText)
  })

  it('nests column blocks while retaining their left-to-right identity', () => {
    const left = makeBlock(
      'left-1',
      'paragraph',
      [{ text: 'Left text', itemIndexes: [0], x: 20, y: 100 }],
      0,
    )
    const right = makeBlock(
      'right-1',
      'paragraph',
      [{ text: 'Right text', itemIndexes: [1], x: 320, y: 100 }],
      1,
    )
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [left, right],
        rawItems: [
          makeItem(0, 'Left text', 20, 100),
          makeItem(1, 'Right text', 320, 100),
        ],
        pdfText: 'Left text Right text',
        layoutKind: 'multi-column',
        columns: [
          { index: 0, xStart: 20, xEnd: 200, blockIds: ['left-1'] },
          { index: 1, xStart: 320, xEnd: 500, blockIds: ['right-1'] },
        ],
      }),
    )
    const columns = document.pages[0].blocks[0]

    expect(columns.type).toBe('columns')
    expect(columns.columns?.map((column) => column.blocks[0].text)).toEqual([
      'Left text',
      'Right text',
    ])
  })

  it('preserves OCR text, confidence, and uncertainty without repairing it', () => {
    const document = createStructuredDocument(
      makeExtractedPdf({
        pdfText: 'Native page text',
        ocrText: 'ANEKS NR 1? 13 1OO PLN',
        confidence: 62,
        needsReview: true,
      }),
    )

    expect(document.pages[0]).toMatchObject({
      extractionMethod: 'mixed',
      sourceText: {
        pdfjs: 'Native page text',
        ocr: 'ANEKS NR 1? 13 1OO PLN',
      },
      confidence: 62,
      needsReview: true,
      blocks: [
        {
          type: 'unknown',
          text: 'ANEKS NR 1? 13 1OO PLN',
          source: {
            method: 'ocr',
            originalText: 'ANEKS NR 1? 13 1OO PLN',
            confidence: 62,
            needsReview: true,
            coordinates: null,
          },
        },
      ],
    })
  })

  it('retains uncertain layout state and flags signature-like text only as a candidate', () => {
    const signature = makeBlock('block-1', 'paragraph', [
      { text: 'Podpis Zamawiającego', itemIndexes: [0], x: 20, y: 100 },
    ])
    const document = createStructuredDocument(
      makeExtractedPdf({
        blocks: [signature],
        rawItems: [makeItem(0, 'Podpis Zamawiającego', 20, 100)],
        pdfText: 'Podpis Zamawiającego',
        layoutKind: 'uncertain',
      }),
    )

    expect(document.pages[0].needsReview).toBe(true)
    expect(document.pages[0].blocks[0].type).toBe('signature')
  })
})
