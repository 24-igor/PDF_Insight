import type {
  ExtractedPdf,
  PdfLayoutBlock,
  PdfLayoutLine,
  RawPdfTextItem,
} from './types'

export type StructuredBlockType =
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'card'
  | 'columns'
  | 'header'
  | 'footer'
  | 'signature'
  | 'unknown'

export type StructuredSource = {
  method: 'pdfjs' | 'ocr'
  originalText: string
  itemIndexes: number[]
  coordinates: { x: number; y: number; width: number; height: number } | null
  confidence: number | null
  needsReview: boolean
}

export type StructuredCell = {
  columnIndex: number
  text: string
  sourceItemIndexes: number[]
  x: number
}

export type StructuredRow = {
  sourceLineNumber: number
  cells: StructuredCell[]
}

export type StructuredField = {
  order: number
  text: string
  sourceItemIndexes: number[]
  coordinates: PdfLayoutLine['bounds']
}

export type StructuredBlock = {
  id: string
  type: StructuredBlockType
  confidence: 'low' | 'medium' | 'unknown'
  text: string
  source: StructuredSource
  reason: string
  fields?: StructuredField[]
  rows?: StructuredRow[]
  columns?: Array<{ index: number; blocks: StructuredBlock[] }>
}

export type StructuredDocumentPage = {
  pageNumber: number
  width: number
  height: number
  extractionMethod: 'pdfjs' | 'ocr' | 'mixed' | 'none'
  sourceText: { pdfjs: string; ocr: string | null }
  readingOrderText: string
  markdownText: string
  confidence: number | null
  needsReview: boolean
  warnings: string[]
  layoutKind: 'single-column' | 'multi-column' | 'uncertain'
  blocks: StructuredBlock[]
  rawItems: RawPdfTextItem[]
}

export type StructuredDocument = {
  format: 'pdf-insight-structured-document'
  version: 1
  filename: string
  pageCount: number
  language: null
  readingOrderText: string
  markdownText: string
  pages: StructuredDocumentPage[]
}

function mapBlockType(block: PdfLayoutBlock): StructuredBlockType {
  switch (block.type) {
    case 'heading_candidate':
      return 'heading'
    case 'table_candidate':
      return 'table'
    case 'card_candidate':
      return 'card'
    case 'header_candidate':
      return 'header'
    case 'footer_candidate':
      return 'footer'
    case 'paragraph':
      return /\b(podpis\w*|podpisano)\b/i.test(
        block.lines.map((line) => line.text).join(' '),
      )
        ? 'signature'
        : 'paragraph'
    default:
      return 'unknown'
  }
}

function getOriginalText(
  itemIndexes: number[],
  itemByIndex: Map<number, RawPdfTextItem>,
): string {
  return itemIndexes.map((index) => itemByIndex.get(index)?.str ?? '').join('')
}

function getBlockSource(
  block: PdfLayoutBlock,
  itemByIndex: Map<number, RawPdfTextItem>,
): StructuredSource {
  const itemIndexes = [
    ...new Set(block.lines.flatMap((line) => line.itemIndexes)),
  ]
  return {
    method: 'pdfjs',
    originalText: getOriginalText(itemIndexes, itemByIndex),
    itemIndexes,
    coordinates: { ...block.bounds },
    confidence: null,
    needsReview: block.confidence === 'low',
  }
}

function createFields(lines: PdfLayoutLine[]): StructuredField[] {
  return lines.map((line, order) => ({
    order,
    text: line.text,
    sourceItemIndexes: [...line.itemIndexes],
    coordinates: { ...line.bounds },
  }))
}

function getItemFontSize(item: RawPdfTextItem): number {
  return Math.max(
    item.height,
    Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0),
    1,
  )
}

function joinCellItems(items: RawPdfTextItem[]): string {
  let text = ''
  let previous: RawPdfTextItem | undefined
  for (const item of items) {
    if (!item.str) continue
    if (previous) {
      const gap =
        (item.transform[4] ?? 0) -
        ((previous.transform[4] ?? 0) + previous.width)
      const wordSpaceThreshold =
        ((getItemFontSize(item) + getItemFontSize(previous)) / 2) * 0.24
      const hasExplicitSpace = /\s$/.test(text) || /^\s/.test(item.str)
      if (
        !hasExplicitSpace &&
        Number.isFinite(gap) &&
        gap >= wordSpaceThreshold
      ) {
        text += ' '
      }
    }
    text += item.str
    previous = item
  }
  return text.trim()
}

function createRows(
  block: PdfLayoutBlock,
  itemByIndex: Map<number, RawPdfTextItem>,
): StructuredRow[] {
  const anchorTolerance = Math.max(18, block.lines[0]?.fontSize * 2 || 18)
  const anchors: Array<{ x: number; lineNumbers: Set<number> }> = []
  for (const line of block.lines) {
    const items = line.itemIndexes
      .map((index) => itemByIndex.get(index))
      .filter((item): item is RawPdfTextItem => Boolean(item))
      .filter((item) => item.str.trim().length > 0)
      .sort(
        (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
      )
    const candidateStarts = items.flatMap((item, index) => {
      if (index === 0) return [item.transform[4] ?? 0]
      const previous = items[index - 1]
      const gap =
        (item.transform[4] ?? 0) -
        ((previous.transform[4] ?? 0) + previous.width)
      const fontSize = (getItemFontSize(item) + getItemFontSize(previous)) / 2
      const cellBoundaryThreshold = Math.max(
        fontSize * 1.5,
        block.bounds.width * 0.015,
      )
      return gap >= cellBoundaryThreshold ? [item.transform[4] ?? 0] : []
    })
    for (const x of candidateStarts) {
      let anchor = anchors.find(
        (candidate) => Math.abs(candidate.x - x) <= anchorTolerance,
      )
      if (!anchor) {
        anchor = { x, lineNumbers: new Set() }
        anchors.push(anchor)
      }
      anchor.lineNumbers.add(line.lineNumber)
    }
  }
  const stableAnchors =
    block.lines.length < 2
      ? []
      : anchors.sort((left, right) => left.x - right.x)

  return block.lines.map((line) => {
    const grouped = new Map<number, RawPdfTextItem[]>()
    const items = line.itemIndexes
      .map((index) => itemByIndex.get(index))
      .filter((item): item is RawPdfTextItem => Boolean(item))
      .filter((item) => item.str.trim().length > 0)
      .sort(
        (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
      )
    let columnIndex = 0
    let previous: RawPdfTextItem | undefined
    for (const item of items) {
      if (previous) {
        const gap =
          (item.transform[4] ?? 0) -
          ((previous.transform[4] ?? 0) + previous.width)
        const fontSize = (getItemFontSize(item) + getItemFontSize(previous)) / 2
        const cellBoundaryThreshold = Math.max(
          fontSize * 1.5,
          block.bounds.width * 0.015,
        )
        const anchorIndex = stableAnchors.reduce<number | null>(
          (closest, anchor, index) => {
            const distance = Math.abs(anchor.x - (item.transform[4] ?? 0))
            if (distance > Math.max(anchorTolerance, fontSize * 4))
              return closest
            if (closest === null) return index
            const closestDistance = Math.abs(
              stableAnchors[closest].x - (item.transform[4] ?? 0),
            )
            return distance < closestDistance ? index : closest
          },
          null,
        )
        if (gap >= cellBoundaryThreshold && anchorIndex !== null) {
          columnIndex = anchorIndex
        }
      }
      if (!grouped.has(columnIndex)) grouped.set(columnIndex, [])
      grouped.get(columnIndex)?.push(item)
      previous = item
    }
    const cells = [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([columnIndex, items]) => ({
        columnIndex,
        text: joinCellItems(
          items.sort(
            (left, right) =>
              (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
          ),
        ),
        sourceItemIndexes: items.map((item) => item.index),
        x: items[0]?.transform[4] ?? 0,
      }))
    return { sourceLineNumber: line.lineNumber, cells }
  })
}

function createBlock(
  block: PdfLayoutBlock,
  itemByIndex: Map<number, RawPdfTextItem>,
): StructuredBlock {
  const type = mapBlockType(block)
  const lines = block.lines
  const text = lines.map((line) => line.text).join('\n')
  return {
    id: block.id,
    type,
    confidence: block.confidence,
    text,
    source: getBlockSource(block, itemByIndex),
    reason: block.reason,
    ...(type === 'card' ? { fields: createFields(lines) } : {}),
    ...(type === 'table' ? { rows: createRows(block, itemByIndex) } : {}),
  }
}

function createOcrBlock(
  pageNumber: number,
  text: string,
  confidence: number | null,
  needsReview: boolean,
): StructuredBlock {
  return {
    id: `p${pageNumber}-ocr-1`,
    type: 'unknown',
    confidence:
      confidence === null ? 'unknown' : confidence < 95 ? 'low' : 'medium',
    text,
    source: {
      method: 'ocr',
      originalText: text,
      itemIndexes: [],
      coordinates: null,
      confidence,
      needsReview,
    },
    reason:
      'OCR text is preserved without semantic classification or correction.',
  }
}

function formatBlockAsMarkdown(
  block: StructuredBlock,
  state: { cardNumber: number },
): string {
  if (block.type === 'columns' && block.columns) {
    return block.columns
      .map((column) => {
        const contents = column.blocks
          .map((child) => formatBlockAsMarkdown(child, state))
          .filter(Boolean)
          .join('\n\n')
        return `Kolumna ${column.index + 1}\n\n${contents}`
      })
      .join('\n\n')
  }
  if (block.type === 'card') {
    state.cardNumber += 1
    return `Karta ${state.cardNumber}\n\n${block.text}`
  }
  if (block.type === 'table' && block.rows) {
    const rows = block.rows
      .map((row) => row.cells.map((cell) => cell.text).join(' | '))
      .filter(Boolean)
      .map((row) => `- ${row}`)
    return rows.length ? `Tabela\n\n${rows.join('\n')}` : block.text
  }
  if (block.source.method === 'ocr') {
    const confidence =
      block.source.confidence === null
        ? ''
        : ` (${Math.round(block.source.confidence)}% confidence)`
    return `Tekst OCR${confidence}\n\n${block.text}`
  }
  if (block.type === 'heading') return block.text
  return block.text
}

function mergeColumnContinuation(
  columns: Array<{ index: number; blocks: StructuredBlock[] }>,
): Array<{ index: number; blocks: StructuredBlock[] }> {
  if (columns.length < 2) return columns
  const left = columns[0]
  const right = columns[1]
  const leftLast = left.blocks.at(-1)
  const rightFirst = right.blocks[0]
  if (!leftLast || !rightFirst) return columns
  const firstLine = rightFirst.text.split('\n')[0]?.trim() ?? ''
  const rest = rightFirst.text
    .slice(rightFirst.text.indexOf('\n') + 1)
    .trimStart()
  const isContinuation =
    firstLine.length > 0 &&
    firstLine.length <= 40 &&
    /^\p{L}[\p{L}\p{M}.'’-]*[.]?$/u.test(firstLine) &&
    /^§\s*\d/.test(rest)
  if (!isContinuation) return columns
  left.blocks[left.blocks.length - 1] = {
    ...leftLast,
    text: `${leftLast.text.trimEnd()} ${firstLine}`,
  }
  right.blocks[0] = {
    ...rightFirst,
    text: rest,
  }
  return columns
}

function mergeDisplayBlocks(
  blocks: StructuredBlock[],
  state: { cardNumber: number },
): string[] {
  const entries = blocks.map((block) => ({
    block,
    text: formatBlockAsMarkdown(block, state),
  }))
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]
    const currentBounds = current.block.source.coordinates
    if (!currentBounds) continue
    if (/-$/.test(current.text.trim())) {
      const numberIndex = entries.findIndex(
        (entry, candidateIndex) =>
          candidateIndex > index &&
          candidateIndex <= index + 3 &&
          /^\d+$/.test(entry.text.trim()),
      )
      if (numberIndex >= 0) {
        current.text = `${current.text.trimEnd()}${entries[numberIndex].text.trimStart()}`
        entries.splice(numberIndex, 1)
        index -= 1
        continue
      }
    }
    const next = entries[index + 1]
    if (!next) continue
    const nextBounds = next.block.source.coordinates
    if (!nextBounds) continue
    const xClose = Math.abs(currentBounds.x - nextBounds.x) <= 48
    const yClose =
      Math.abs(currentBounds.y - nextBounds.y) <=
      Math.max(currentBounds.height, nextBounds.height) * 2
    const wrappedLowercase =
      current.block.type === 'paragraph' &&
      next.block.type === 'paragraph' &&
      xClose &&
      yClose &&
      /^\p{Ll}/u.test(next.text.trim())
    if (!wrappedLowercase) continue
    const continuation = next.text.trimStart()
    if (
      /\bwg\s+\d+\s+\d/.test(current.text) &&
      /^umowy\b/i.test(continuation)
    ) {
      current.text = current.text.replace(
        /\bwg\s+(?=\d+\s+\d)/,
        `wg ${continuation} `,
      )
    } else {
      current.text = `${current.text.trimEnd()} ${continuation}`
    }
    entries.splice(index + 1, 1)
    index -= 1
  }
  return entries.map((entry) => entry.text).filter(Boolean)
}

function createColumnsBlock(
  pageNumber: number,
  layout: NonNullable<ExtractedPdf['pages'][number]['diagnostics']>['layout'],
  blocks: StructuredBlock[],
  itemByIndex: Map<number, RawPdfTextItem>,
): StructuredBlock | null {
  if (layout.layoutKind !== 'multi-column' || layout.columns.length < 2)
    return null
  const columns = layout.columns.map((column) => ({
    index: column.index,
    blocks: blocks.filter((block) => {
      const layoutBlock = layout.blocks.find((entry) => entry.id === block.id)
      return layoutBlock?.columnIndex === column.index
    }),
  }))
  mergeColumnContinuation(columns)
  const children = columns.flatMap((column) => column.blocks)
  const itemIndexes = [
    ...new Set(children.flatMap((block) => block.source.itemIndexes)),
  ]
  const sourceBounds = children
    .map((block) => block.source.coordinates)
    .filter(Boolean)
  const bounds = sourceBounds.length
    ? {
        x: Math.min(...sourceBounds.map((box) => box!.x)),
        y: Math.min(...sourceBounds.map((box) => box!.y)),
        width:
          Math.max(...sourceBounds.map((box) => box!.x + box!.width)) -
          Math.min(...sourceBounds.map((box) => box!.x)),
        height:
          Math.max(...sourceBounds.map((box) => box!.y + box!.height)) -
          Math.min(...sourceBounds.map((box) => box!.y)),
      }
    : null
  return {
    id: `p${pageNumber}-columns`,
    type: 'columns',
    confidence: 'low',
    text: columns
      .map((column) => column.blocks.map((block) => block.text).join('\n'))
      .join('\n\n'),
    source: {
      method: 'pdfjs',
      originalText: getOriginalText(itemIndexes, itemByIndex),
      itemIndexes,
      coordinates: bounds,
      confidence: null,
      needsReview: true,
    },
    reason: 'Column grouping is heuristic and should be reviewed.',
    columns,
  }
}

export function createStructuredDocument(
  extracted: ExtractedPdf,
): StructuredDocument {
  const pages = extracted.pages.map((page) => {
    const diagnostics = page.diagnostics
    const rawItems = diagnostics?.rawItems ?? []
    const itemByIndex = new Map(rawItems.map((item) => [item.index, item]))
    const nativeBlocks =
      diagnostics?.layout.blocks.map((block) =>
        createBlock(block, itemByIndex),
      ) ?? []
    const columnsBlock = diagnostics
      ? createColumnsBlock(
          page.pageNumber,
          diagnostics.layout,
          nativeBlocks,
          itemByIndex,
        )
      : null
    const columnChildIds = new Set(
      columnsBlock?.columns?.flatMap((column) =>
        column.blocks.map((block) => block.id),
      ) ?? [],
    )
    const blocks = nativeBlocks.filter((block) => !columnChildIds.has(block.id))
    if (columnsBlock) blocks.push(columnsBlock)
    if (page.ocrText) {
      blocks.push(
        createOcrBlock(
          page.pageNumber,
          page.ocrText,
          page.confidence,
          page.needsReview,
        ),
      )
    }
    const hasNativeText = Boolean(page.pdfText)
    const hasOcrText = Boolean(page.ocrText)
    const extractionMethod: StructuredDocumentPage['extractionMethod'] =
      hasNativeText && hasOcrText
        ? 'mixed'
        : hasNativeText
          ? 'pdfjs'
          : hasOcrText
            ? 'ocr'
            : 'none'
    blocks.sort((left, right) => {
      const leftBounds = left.source.coordinates
      const rightBounds = right.source.coordinates
      if (!leftBounds) return rightBounds ? 1 : 0
      if (!rightBounds) return -1
      return (
        rightBounds.y +
          rightBounds.height -
          (leftBounds.y + leftBounds.height) || leftBounds.x - rightBounds.x
      )
    })
    const markdownState = { cardNumber: 0 }
    const displayBlocks = mergeDisplayBlocks(blocks, markdownState)
    return {
      pageNumber: page.pageNumber,
      width: diagnostics?.pageWidth ?? 0,
      height: diagnostics?.pageHeight ?? 0,
      extractionMethod,
      sourceText: { pdfjs: page.pdfText, ocr: page.ocrText },
      readingOrderText: blocks
        .map((block) => block.text)
        .filter(Boolean)
        .join('\n\n'),
      markdownText: displayBlocks.join('\n\n'),
      confidence: hasOcrText ? page.confidence : null,
      needsReview:
        page.needsReview || diagnostics?.layout.layoutKind === 'uncertain',
      warnings: [
        ...page.warnings,
        ...(diagnostics?.layout.layoutKind === 'uncertain'
          ? ['Layout classification is uncertain.']
          : []),
      ],
      layoutKind: diagnostics?.layout.layoutKind ?? 'uncertain',
      blocks,
      rawItems,
    }
  })

  return {
    format: 'pdf-insight-structured-document',
    version: 1,
    filename: extracted.fileName,
    pageCount: extracted.pageCount,
    language: null,
    readingOrderText: pages
      .map((page) => page.readingOrderText)
      .filter(Boolean)
      .join('\n\n'),
    markdownText: pages
      .map((page) => `Strona ${page.pageNumber}\n\n${page.markdownText}`)
      .filter(Boolean)
      .join('\n\n'),
    pages,
  }
}
