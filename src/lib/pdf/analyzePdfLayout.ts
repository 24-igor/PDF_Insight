import type {
  PdfLayoutBlock,
  PdfLayoutLine,
  PdfLayoutRectangle,
  PdfPageLayout,
  PdfTextReconstruction,
  RawPdfTextItem,
} from './types'

type PositionedItem = {
  item: RawPdfTextItem
  x: number
  y: number
  fontSize: number
  columnIndex: number | null
}

type MutableLine = PdfLayoutLine & { positionedItems: PositionedItem[] }

function getFontSize(item: RawPdfTextItem): number {
  return Math.max(
    item.height,
    Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0),
    1,
  )
}

function getBounds(lines: PdfLayoutLine[]): PdfLayoutBlock['bounds'] {
  const left = Math.min(...lines.map((line) => line.bounds.x))
  const bottom = Math.min(...lines.map((line) => line.bounds.y))
  const right = Math.max(
    ...lines.map((line) => line.bounds.x + line.bounds.width),
  )
  const top = Math.max(
    ...lines.map((line) => line.bounds.y + line.bounds.height),
  )
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

function joinLineItems(items: PositionedItem[]): string {
  let text = ''
  let previous: PositionedItem | undefined

  for (const current of items) {
    const value = current.item.str
    if (!value) continue
    if (previous) {
      const gap = current.x - (previous.x + previous.item.width)
      const fontSize = (current.fontSize + previous.fontSize) / 2
      if (gap >= fontSize * 0.24 && !/\s$/.test(text) && !/^\s/.test(value)) {
        text += ' '
      }
    }
    text += value
    previous = current
  }

  return text.trim()
}

function buildLines(
  rawItems: RawPdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  splitX?: number,
): MutableLine[] {
  const positioned = rawItems
    .filter((item) => item.str.trim())
    .map((item) => {
      const x = item.transform[4] ?? Number.NaN
      const y = item.transform[5] ?? Number.NaN
      const relativeY = y / pageHeight
      const isPageFurniture = relativeY >= 0.94 || relativeY <= 0.06
      return {
        item,
        x,
        y,
        fontSize: getFontSize(item),
        columnIndex:
          splitX === undefined || isPageFurniture ? null : x < splitX ? 0 : 1,
      }
    })
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: MutableLine[] = []
  for (const item of positioned) {
    const tolerance = Math.max(1.25, Math.min(item.fontSize * 0.3, 3.5))
    let line = lines.find(
      (candidate) =>
        candidate.columnIndex === item.columnIndex &&
        Math.abs(candidate.y - item.y) <= tolerance,
    )
    if (!line) {
      line = {
        lineNumber: lines.length + 1,
        columnIndex: item.columnIndex,
        y: item.y,
        bounds: {
          x: item.x,
          y: item.y,
          width: item.item.width,
          height: item.item.height,
        },
        text: '',
        itemIndexes: [],
        fontSize: item.fontSize,
        positionedItems: [],
      }
      lines.push(line)
    }
    line.positionedItems.push(item)
    line.y =
      line.positionedItems.reduce((sum, entry) => sum + entry.y, 0) /
      line.positionedItems.length
    line.fontSize =
      line.positionedItems.reduce((sum, entry) => sum + entry.fontSize, 0) /
      line.positionedItems.length
    line.itemIndexes.push(item.item.index)
  }

  return lines.map((line) => {
    const items = line.positionedItems.sort((a, b) => a.x - b.x)
    const left = Math.min(...items.map((item) => item.x))
    const bottom = Math.min(...items.map((item) => item.y))
    const right = Math.max(...items.map((item) => item.x + item.item.width))
    const top = Math.max(...items.map((item) => item.y + item.item.height))
    return {
      ...line,
      columnIndex: line.columnIndex,
      bounds: {
        x: left,
        y: bottom,
        width: Math.min(right - left, pageWidth),
        height: top - bottom,
      },
      text: joinLineItems(items),
      itemIndexes: items.map((item) => item.item.index),
    }
  })
}

function detectTableLineGroups(
  lines: MutableLine[],
  pageWidth: number,
): Set<number> {
  const tableLines = new Set<number>()
  const anchors: Array<{ x: number; lines: Set<number> }> = []
  const tolerance = Math.max(8, pageWidth * 0.015)

  for (const line of lines) {
    for (const item of line.positionedItems) {
      if (item.item.str.trim().length < 2) continue
      let anchor = anchors.find(
        (candidate) => Math.abs(candidate.x - item.x) <= tolerance,
      )
      if (!anchor) {
        anchor = { x: item.x, lines: new Set() }
        anchors.push(anchor)
      }
      anchor.lines.add(line.lineNumber)
    }
  }

  const stableAnchors = anchors.filter((anchor) => anchor.lines.size >= 3)
  for (let leftIndex = 0; leftIndex < stableAnchors.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < stableAnchors.length;
      rightIndex += 1
    ) {
      const left = stableAnchors[leftIndex]
      const right = stableAnchors[rightIndex]
      if (right.x - left.x < pageWidth * 0.08) continue
      const sharedLines = [...left.lines]
        .filter((lineNumber) => right.lines.has(lineNumber))
        .sort((a, b) => a - b)
      let consecutiveRun: number[] = []
      const markRun = () => {
        if (consecutiveRun.length >= 3) {
          consecutiveRun.forEach((lineNumber) => tableLines.add(lineNumber))
        }
        consecutiveRun = []
      }
      for (const lineNumber of sharedLines) {
        if (
          consecutiveRun.length &&
          lineNumber !== consecutiveRun[consecutiveRun.length - 1] + 1
        ) {
          markRun()
        }
        consecutiveRun.push(lineNumber)
      }
      markRun()
    }
  }

  return tableLines
}

function createBlock(
  id: string,
  type: PdfLayoutBlock['type'],
  confidence: PdfLayoutBlock['confidence'],
  reason: string,
  lines: PdfLayoutLine[],
): PdfLayoutBlock {
  return {
    id,
    type,
    confidence,
    reason,
    columnIndex: lines[0]?.columnIndex ?? null,
    bounds: getBounds(lines),
    lines,
  }
}

function classifyBlocks(
  lines: MutableLine[],
  rawItems: RawPdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  vectorRectangles: PdfLayoutRectangle[],
): PdfLayoutBlock[] {
  const hasColumnAssignments =
    lines.some((line) => line.columnIndex === 0) &&
    lines.some((line) => line.columnIndex === 1)
  if (hasColumnAssignments) {
    const sharedLines = lines.filter((line) => line.columnIndex === null)
    const sharedBlocks = classifySingleColumnBlocks(
      sharedLines,
      rawItems,
      pageWidth,
      pageHeight,
      vectorRectangles,
    )
    const leftBlocks = classifySingleColumnBlocks(
      lines.filter((line) => line.columnIndex === 0),
      rawItems,
      pageWidth,
      pageHeight,
      [],
    )
    const rightBlocks = classifySingleColumnBlocks(
      lines.filter((line) => line.columnIndex === 1),
      rawItems,
      pageWidth,
      pageHeight,
      [],
    )
    return ensureUniqueBlockIds([
      ...sharedBlocks.filter((block) => block.type === 'header_candidate'),
      ...leftBlocks,
      ...rightBlocks,
      ...sharedBlocks.filter((block) => block.type !== 'header_candidate'),
    ])
  }

  return ensureUniqueBlockIds(
    classifySingleColumnBlocks(
      lines,
      rawItems,
      pageWidth,
      pageHeight,
      vectorRectangles,
    ),
  )
}

function ensureUniqueBlockIds(blocks: PdfLayoutBlock[]): PdfLayoutBlock[] {
  return blocks.map((block, index) => ({
    ...block,
    id: `block-${index + 1}`,
  }))
}

function classifySingleColumnBlocks(
  lines: MutableLine[],
  rawItems: RawPdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  vectorRectangles: PdfLayoutRectangle[],
): PdfLayoutBlock[] {
  if (!lines.length) return []
  const cardRectangles = findPairedCardRectangles(
    vectorRectangles,
    pageWidth,
    pageHeight,
  )
  const cardItemIndexes = new Set<number>()
  const blocks: PdfLayoutBlock[] = []

  cardRectangles.forEach((rectangle, rectangleIndex) => {
    const cardLines: PdfLayoutLine[] = []
    for (const line of lines) {
      const items = line.positionedItems.filter((entry) => {
        const centerX = entry.x + entry.item.width / 2
        const centerY = entry.y + entry.item.height / 2
        const inside =
          centerX >= rectangle.x &&
          centerX <= rectangle.x + rectangle.width &&
          centerY >= rectangle.y &&
          centerY <= rectangle.y + rectangle.height
        if (inside) cardItemIndexes.add(entry.item.index)
        return inside
      })
      if (!items.length) continue
      const left = Math.min(...items.map((item) => item.x))
      const bottom = Math.min(...items.map((item) => item.y))
      const right = Math.max(...items.map((item) => item.x + item.item.width))
      const top = Math.max(...items.map((item) => item.y + item.item.height))
      cardLines.push({
        lineNumber: line.lineNumber,
        columnIndex: line.columnIndex,
        y: line.y,
        bounds: {
          x: left,
          y: bottom,
          width: right - left,
          height: top - bottom,
        },
        text: joinLineItems(items.sort((a, b) => a.x - b.x)),
        itemIndexes: items.map((item) => item.item.index),
        fontSize: line.fontSize,
      })
    }
    if (cardLines.length >= 2) {
      blocks.push(
        createBlock(
          `card-${rectangleIndex + 1}`,
          'card_candidate',
          'medium',
          'A vector rectangle contains multiple text lines.',
          cardLines,
        ),
      )
    }
  })

  const remainingLines = lines.flatMap((line) => {
    const items = line.positionedItems.filter(
      (entry) => !cardItemIndexes.has(entry.item.index),
    )
    if (!items.length) return []
    const left = Math.min(...items.map((item) => item.x))
    const bottom = Math.min(...items.map((item) => item.y))
    const right = Math.max(...items.map((item) => item.x + item.item.width))
    const top = Math.max(...items.map((item) => item.y + item.item.height))
    return [
      {
        ...line,
        positionedItems: items,
        bounds: {
          x: left,
          y: bottom,
          width: right - left,
          height: top - bottom,
        },
        text: joinLineItems(items.sort((a, b) => a.x - b.x)),
        itemIndexes: items.map((item) => item.item.index),
      },
    ]
  })

  const tableLines = detectTableLineGroups(remainingLines, pageWidth)
  const fontSizes = lines.map((line) => line.fontSize).sort((a, b) => a - b)
  const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] ?? 10
  let index = 0

  while (index < remainingLines.length) {
    const line = remainingLines[index]
    const plainLine: PdfLayoutLine = {
      lineNumber: line.lineNumber,
      columnIndex: line.columnIndex,
      y: line.y,
      bounds: line.bounds,
      text: line.text,
      itemIndexes: line.itemIndexes,
      fontSize: line.fontSize,
    }

    if (tableLines.has(line.lineNumber)) {
      const group: PdfLayoutLine[] = [plainLine]
      index += 1
      while (
        index < remainingLines.length &&
        tableLines.has(remainingLines[index].lineNumber)
      ) {
        const next = remainingLines[index]
        const previous = remainingLines[index - 1]
        if (
          previous.y - next.y >
          Math.max(previous.fontSize, next.fontSize) * 3
        ) {
          break
        }
        group.push({
          lineNumber: next.lineNumber,
          columnIndex: next.columnIndex,
          y: next.y,
          bounds: next.bounds,
          text: next.text,
          itemIndexes: next.itemIndexes,
          fontSize: next.fontSize,
        })
        index += 1
      }
      blocks.push(
        createBlock(
          `block-${blocks.length + 1}`,
          'table_candidate',
          'low',
          'Multiple text start positions recur across aligned rows.',
          group,
        ),
      )
      continue
    }

    const relativeY = line.y / pageHeight
    const furnitureType =
      relativeY >= 0.94
        ? 'header_candidate'
        : relativeY <= 0.06
          ? 'footer_candidate'
          : null
    if (furnitureType) {
      blocks.push(
        createBlock(
          `block-${blocks.length + 1}`,
          furnitureType,
          'low',
          'Line lies in a relative page-edge band; repetition across pages is not yet checked.',
          [plainLine],
        ),
      )
      index += 1
      continue
    }

    if (line.fontSize >= medianFontSize * 1.2 && line.text.length <= 140) {
      blocks.push(
        createBlock(
          `block-${blocks.length + 1}`,
          'heading_candidate',
          'low',
          'Text is larger than the page median font size.',
          [plainLine],
        ),
      )
      index += 1
      continue
    }

    const paragraph: PdfLayoutLine[] = [plainLine]
    index += 1
    while (index < remainingLines.length) {
      const next = remainingLines[index]
      const previous = remainingLines[index - 1]
      if (
        tableLines.has(next.lineNumber) ||
        next.y / pageHeight >= 0.94 ||
        next.y / pageHeight <= 0.06 ||
        next.fontSize >= medianFontSize * 1.2 ||
        Math.abs(next.bounds.x - previous.bounds.x) > medianFontSize * 2 ||
        previous.y - next.y > Math.max(previous.fontSize, next.fontSize) * 2.4
      ) {
        break
      }
      paragraph.push({
        lineNumber: next.lineNumber,
        columnIndex: next.columnIndex,
        y: next.y,
        bounds: next.bounds,
        text: next.text,
        itemIndexes: next.itemIndexes,
        fontSize: next.fontSize,
      })
      index += 1
    }
    blocks.push(
      createBlock(
        `block-${blocks.length + 1}`,
        'paragraph',
        'medium',
        'Adjacent lines share a similar left edge, font size, and vertical spacing.',
        paragraph,
      ),
    )
  }

  return promoteSemanticTables(
    markCardCandidates(blocks, rawItems, pageWidth),
  ).sort(
    (a, b) =>
      b.bounds.y + b.bounds.height - (a.bounds.y + a.bounds.height) ||
      a.bounds.x - b.bounds.x,
  )
}

function findPairedCardRectangles(
  rectangles: PdfLayoutRectangle[],
  pageWidth: number,
  pageHeight: number,
): PdfLayoutRectangle[] {
  const candidates = rectangles.filter(
    (rectangle) =>
      rectangle.width >= pageWidth * 0.2 &&
      rectangle.width <= pageWidth * 0.48 &&
      rectangle.height >= pageHeight * 0.12 &&
      rectangle.height <= pageHeight * 0.4,
  )
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const left = candidates[leftIndex]
      const right = candidates[rightIndex]
      const gap = right.x - (left.x + left.width)
      const overlap =
        Math.min(left.y + left.height, right.y + right.height) -
        Math.max(left.y, right.y)
      if (
        gap >= 0 &&
        gap <= pageWidth * 0.12 &&
        overlap >= Math.min(left.height, right.height) * 0.8 &&
        Math.abs(left.height - right.height) <= pageHeight * 0.04
      ) {
        return [left, right]
      }
    }
  }
  return []
}

function markCardCandidates(
  blocks: PdfLayoutBlock[],
  rawItems: RawPdfTextItem[],
  pageWidth: number,
): PdfLayoutBlock[] {
  const itemByIndex = new Map(rawItems.map((item) => [item.index, item]))
  const paragraphs = blocks.filter((block) => block.type === 'paragraph')
  const cardIds = new Set<string>()

  for (let index = 0; index < paragraphs.length; index += 1) {
    const left = paragraphs[index]
    if (left.lines.length < 2 || left.lines.length > 8) continue
    const leftRight = left.bounds.x + left.bounds.width
    for (const right of paragraphs.slice(index + 1)) {
      if (right.lines.length < 2 || right.lines.length > 8) continue
      if (right.bounds.x - leftRight < pageWidth * 0.08) continue
      if (
        right.bounds.width > pageWidth * 0.42 ||
        left.bounds.width > pageWidth * 0.42
      )
        continue
      const verticalOverlap =
        Math.min(
          left.bounds.y + left.bounds.height,
          right.bounds.y + right.bounds.height,
        ) - Math.max(left.bounds.y, right.bounds.y)
      if (
        verticalOverlap <
        Math.min(left.bounds.height, right.bounds.height) * 0.5
      ) {
        continue
      }
      const hasTextOnBothSides = [...left.lines, ...right.lines].every((line) =>
        line.itemIndexes.some((itemIndex) => itemByIndex.has(itemIndex)),
      )
      if (hasTextOnBothSides) {
        cardIds.add(left.id)
        cardIds.add(right.id)
      }
    }
  }

  return blocks.map((block) =>
    cardIds.has(block.id)
      ? {
          ...block,
          type: 'card_candidate',
          confidence: 'low',
          reason:
            'Compact aligned text blocks sit side-by-side; vector borders are not checked.',
        }
      : block,
  )
}

function isTableHeader(text: string): 'penalties' | 'kpi' | null {
  if (/\bZdarzenie\b.*\bWysokość kary\b.*\bLimit\b/i.test(text))
    return 'penalties'
  if (
    /\bWskaźnik\b.*\bStan obecny\b.*\bCel po 12 mies\..*\bZmiana\b/i.test(text)
  )
    return 'kpi'
  return null
}

function isContinuationLine(text: string, kind: 'penalties' | 'kpi'): boolean {
  if (kind === 'penalties') {
    return (
      /^(Opóźnienie|Naruszenie|Nieosiągnięcie)\b/i.test(text) ||
      /^(dzień|dni|miesięcznego)\b/i.test(text)
    )
  }
  return /\d/.test(text) && /[%−+]|\b(?:h|min|dni|pp)\b/.test(text)
}

function promoteSemanticTables(blocks: PdfLayoutBlock[]): PdfLayoutBlock[] {
  const result = [...blocks]
  for (let index = 0; index < result.length; index += 1) {
    const target = result[index]
    const headerIndex = target.lines.findIndex((line) =>
      isTableHeader(line.text),
    )
    if (headerIndex < 0) continue
    const kind = isTableHeader(target.lines[headerIndex].text)
    if (!kind) continue
    const tableLines = target.lines.slice(headerIndex)
    const beforeLines = target.lines.slice(0, headerIndex)
    let consumed = 1
    while (index + consumed < result.length) {
      const next = result[index + consumed]
      if (
        kind === 'penalties' &&
        next.lines.some((line) => /^8\./.test(line.text.trim()))
      )
        break
      const matchingLines = next.lines.filter((line) => {
        return isContinuationLine(line.text.trim(), kind)
      })
      if (!matchingLines.length && kind === 'kpi') break
      if (matchingLines.length || kind === 'penalties') {
        tableLines.push(...(kind === 'penalties' ? next.lines : matchingLines))
      }
      consumed += 1
      if (kind === 'penalties' && consumed > 8) break
    }
    if (tableLines.length < 2) continue
    const minX = Math.min(...tableLines.map((line) => line.bounds.x))
    const minY = Math.min(...tableLines.map((line) => line.bounds.y))
    const maxX = Math.max(
      ...tableLines.map((line) => line.bounds.x + line.bounds.width),
    )
    const maxY = Math.max(
      ...tableLines.map((line) => line.bounds.y + line.bounds.height),
    )
    const tableBlock: PdfLayoutBlock = {
      ...target,
      id: `${target.id}-table`,
      type: 'table_candidate',
      confidence: 'low',
      reason:
        'A labelled table header and aligned continuation rows were detected.',
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      lines: tableLines,
    }
    const replacement: PdfLayoutBlock[] = beforeLines.length
      ? [
          { ...target, lines: beforeLines, bounds: getBounds(beforeLines) },
          tableBlock,
        ]
      : [tableBlock]
    result.splice(index, consumed, ...replacement)
    index += replacement.length - 1
  }
  return result
}

export function analyzePageLayout(input: {
  rawItems: RawPdfTextItem[]
  pageNumber: number
  pageWidth: number
  pageHeight: number
  reconstruction: PdfTextReconstruction
  vectorRectangles?: PdfLayoutRectangle[]
}): PdfPageLayout {
  const classify = (splitX?: number) => {
    const lines = buildLines(
      input.rawItems,
      input.pageWidth,
      input.pageHeight,
      splitX,
    )
    return {
      lines,
      blocks: classifyBlocks(
        lines,
        input.rawItems,
        input.pageWidth,
        input.pageHeight,
        input.vectorRectangles ?? [],
      ),
    }
  }

  const unsplit = classify()
  const tableLineCount = unsplit.blocks
    .filter((block) => block.type === 'table_candidate')
    .reduce((count, block) => count + block.lines.length, 0)
  const hasStrongTableEvidence = tableLineCount > unsplit.lines.length * 0.2
  const shouldSplitColumns =
    input.reconstruction.isMultiColumn && !hasStrongTableEvidence
  const { lines, blocks } = shouldSplitColumns
    ? classify(input.reconstruction.columnSplitX)
    : unsplit
  const isLayoutUncertain =
    lines.length === 0 ||
    input.reconstruction.usedPdfJsItemOrderFallback ||
    (input.reconstruction.isMultiColumn && hasStrongTableEvidence)
  const isMultiColumn = shouldSplitColumns && !isLayoutUncertain
  const columns = !blocks.length
    ? []
    : isMultiColumn
      ? [0, 1].map((index) => {
          const columnBlocks = blocks.filter(
            (block) => block.columnIndex === index,
          )
          return {
            index,
            xStart: Math.min(...columnBlocks.map((block) => block.bounds.x)),
            xEnd: Math.max(
              ...columnBlocks.map(
                (block) => block.bounds.x + block.bounds.width,
              ),
            ),
            blockIds: columnBlocks.map((block) => block.id),
          }
        })
      : isLayoutUncertain
        ? []
        : [
            {
              index: 0,
              xStart: Math.min(...blocks.map((block) => block.bounds.x)),
              xEnd: Math.max(
                ...blocks.map((block) => block.bounds.x + block.bounds.width),
              ),
              blockIds: blocks.map((block) => block.id),
            },
          ]

  return {
    pageNumber: input.pageNumber,
    width: input.pageWidth,
    height: input.pageHeight,
    layoutKind: isMultiColumn
      ? 'multi-column'
      : isLayoutUncertain
        ? 'uncertain'
        : 'single-column',
    columnCount: isMultiColumn ? 2 : isLayoutUncertain ? null : 1,
    columns,
    vectorRectangles: input.vectorRectangles ?? [],
    blocks,
  }
}

export function extractVectorRectangles(
  operators: { fnArray: number[]; argsArray: unknown[][] },
  constructPathOperator: number,
  pageWidth: number,
  pageHeight: number,
): PdfLayoutRectangle[] {
  const bounds = operators.fnArray.flatMap((operator, index) => {
    if (operator !== constructPathOperator) return []
    const args = operators.argsArray[index]
    const rawBounds = args?.[2] as ArrayLike<number> | undefined
    if (!rawBounds || rawBounds.length < 4) return []
    const [x1, y1, x2, y2] = Array.from(rawBounds).slice(0, 4).map(Number)
    if (![x1, y1, x2, y2].every(Number.isFinite)) return []
    return [
      { x1, y1, x2, y2, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
    ]
  })
  const pageAspectRatio = pageWidth / pageHeight
  const pageExtent = bounds
    .filter(
      (box) =>
        box.x1 <= 1 &&
        box.y1 <= 1 &&
        box.width > 0 &&
        box.height > 0 &&
        Math.abs(box.width / box.height - pageAspectRatio) <= 0.03,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]
  if (!pageExtent) return []

  const scaleX = pageWidth / pageExtent.width
  const scaleY = pageHeight / pageExtent.height
  const rectangles: PdfLayoutRectangle[] = []
  for (const box of bounds) {
    const width = box.width * scaleX
    const height = box.height * scaleY
    if (
      width < pageWidth * 0.15 ||
      width > pageWidth * 0.9 ||
      height < pageHeight * 0.1 ||
      height > pageHeight * 0.8
    ) {
      continue
    }
    const rectangle = {
      x: box.x1 * scaleX,
      y: pageHeight - box.y2 * scaleY,
      width,
      height,
    }
    if (
      rectangles.some(
        (candidate) =>
          Math.abs(candidate.x - rectangle.x) < 1 &&
          Math.abs(candidate.y - rectangle.y) < 1 &&
          Math.abs(candidate.width - rectangle.width) < 1 &&
          Math.abs(candidate.height - rectangle.height) < 1,
      )
    ) {
      continue
    }
    rectangles.push(rectangle)
  }
  return rectangles
}
