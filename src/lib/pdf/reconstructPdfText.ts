import type {
  PdfTextReconstruction,
  ReconstructedLine,
  RawPdfTextItem,
} from './types'

type PositionedItem = {
  item: RawPdfTextItem
  x: number
  y: number
  fontSize: number
}

type MutableLine = {
  y: number
  items: PositionedItem[]
}

type LayoutDetection = {
  kind: 'single-column' | 'multi-column' | 'uncertain'
  splitX?: number
}

function getFontSize(item: RawPdfTextItem): number {
  const a = item.transform[0] ?? 0
  const b = item.transform[1] ?? 0
  return Math.max(item.height, Math.hypot(a, b), 1)
}

function getLineTolerance(a: PositionedItem, b: PositionedItem): number {
  return Math.max(1.25, Math.min(Math.max(a.fontSize, b.fontSize) * 0.3, 3.5))
}

function buildGeometricLines(items: RawPdfTextItem[]): MutableLine[] {
  const lines: MutableLine[] = []
  let previousItem: PositionedItem | undefined

  for (const item of items) {
    if (!item.str.trim()) continue
    const positioned: PositionedItem = {
      item,
      x: item.transform[4] ?? Number.NaN,
      y: item.transform[5] ?? Number.NaN,
      fontSize: getFontSize(item),
    }
    const canContinuePreviousLine = !previousItem?.item.hasEOL
    const candidate = canContinuePreviousLine
      ? lines
          .map((line) => ({
            line,
            distance: Math.abs(line.y - positioned.y),
          }))
          .filter(
            ({ line, distance }) =>
              distance <= getLineTolerance(line.items[0], positioned),
          )
          .sort((a, b) => a.distance - b.distance)[0]?.line
      : undefined

    if (candidate) {
      candidate.items.push(positioned)
      candidate.y =
        candidate.items.reduce((sum, entry) => sum + entry.y, 0) /
        candidate.items.length
    } else {
      lines.push({ y: positioned.y, items: [positioned] })
    }
    previousItem = positioned
  }

  return lines.sort((a, b) => b.y - a.y)
}

function detectMultiColumnLayout(
  items: RawPdfTextItem[],
  lines: MutableLine[],
  pageWidth: number,
  pageHeight: number,
): LayoutDetection {
  const anchors = lines
    .map((line) => ({
      x: Math.min(...line.items.map((entry) => entry.x)),
      y: line.y,
      maxX: Math.max(...line.items.map((entry) => entry.x + entry.item.width)),
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((a, b) => a.x - b.x)
  const clusters: Array<{ x: number; ys: number[] }> = []
  const anchorTolerance = Math.max(12, pageWidth * 0.025)

  for (const anchor of anchors) {
    const cluster = clusters.find(
      (candidate) => Math.abs(candidate.x - anchor.x) <= anchorTolerance,
    )
    if (cluster) {
      cluster.ys.push(anchor.y)
      cluster.x =
        cluster.ys.length === 1
          ? anchor.x
          : cluster.x + (anchor.x - cluster.x) / cluster.ys.length
    } else {
      clusters.push({ x: anchor.x, ys: [anchor.y] })
    }
  }

  let anchorBasedLayout: LayoutDetection | undefined
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const left = clusters[i]
      const right = clusters[j]
      const overlap =
        Math.min(Math.max(...left.ys), Math.max(...right.ys)) -
        Math.max(Math.min(...left.ys), Math.min(...right.ys))
      const separated = right.x - left.x >= pageWidth * 0.2
      const spansPage = overlap >= pageHeight * 0.12
      const balanced =
        Math.min(left.ys.length, right.ys.length) /
          Math.max(left.ys.length, right.ys.length) >=
        0.5
      if (!separated || !spansPage || !balanced) continue

      if (left.ys.length >= 8 && right.ys.length >= 8) {
        const leftEnds = anchors
          .filter((anchor) => Math.abs(anchor.x - left.x) <= anchorTolerance)
          .map((anchor) => anchor.maxX)
          .sort((a, b) => a - b)
        const leftEnd = leftEnds[Math.floor((leftEnds.length - 1) * 0.75)]
        anchorBasedLayout = {
          kind: 'multi-column',
          splitX: (leftEnd + right.x) / 2,
        }
        break
      }
    }
    if (anchorBasedLayout) break
  }

  const sortedItems = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      item,
      x: item.transform[4] ?? Number.NaN,
      y: item.transform[5] ?? Number.NaN,
      fontSize: getFontSize(item),
    }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  const physicalRows: PositionedItem[][] = []
  for (const entry of sortedItems) {
    const row = physicalRows.find((candidate) =>
      candidate.some(
        (item) => Math.abs(item.y - entry.y) <= getLineTolerance(item, entry),
      ),
    )
    if (row) row.push(entry)
    else physicalRows.push([entry])
  }

  const gapCenters: Array<{ x: number; y: number }> = []
  for (const row of physicalRows) {
    const positioned = row.slice().sort((a, b) => a.x - b.x)
    for (let index = 1; index < positioned.length; index += 1) {
      const previous = positioned[index - 1]
      const current = positioned[index]
      const gap = current.x - (previous.x + previous.item.width)
      const minColumnGap = Math.max(
        ((current.fontSize + previous.fontSize) / 2) * 2.5,
        pageWidth * 0.035,
      )
      if (gap >= minColumnGap) {
        gapCenters.push({
          x: (current.x + previous.x + previous.item.width) / 2,
          y: row[0].y,
        })
      }
    }
  }

  const gapClusters: Array<{ x: number; ys: number[] }> = []
  for (const gap of gapCenters) {
    const cluster = gapClusters.find(
      (candidate) => Math.abs(candidate.x - gap.x) <= pageWidth * 0.04,
    )
    if (cluster) {
      cluster.ys.push(gap.y)
      cluster.x += (gap.x - cluster.x) / cluster.ys.length
    } else {
      gapClusters.push({ x: gap.x, ys: [gap.y] })
    }
  }

  const repeatedGap = gapClusters
    .filter((cluster) => cluster.ys.length >= 5)
    .sort((a, b) => b.ys.length - a.ys.length)[0]
  if (repeatedGap) {
    const leftEvidence = sortedItems.filter(
      (entry) => entry.x + entry.item.width <= repeatedGap.x,
    ).length
    const rightEvidence = sortedItems.filter(
      (entry) => entry.x >= repeatedGap.x,
    ).length
    const verticalSpan =
      Math.max(...repeatedGap.ys) - Math.min(...repeatedGap.ys)
    if (
      leftEvidence >= 5 &&
      rightEvidence >= 5 &&
      verticalSpan >= pageHeight * 0.2
    ) {
      return { kind: 'multi-column', splitX: repeatedGap.x }
    }
  }

  if (anchorBasedLayout) return anchorBasedLayout

  const dominantAnchorCount = Math.max(
    0,
    ...clusters.map((entry) => entry.ys.length),
  )
  if (
    dominantAnchorCount >= Math.ceil(lines.length * 0.7) &&
    (clusters.length > 1 || gapCenters.length < 2)
  ) {
    return { kind: 'single-column' }
  }

  const plausibleColumns = clusters.some((left, index) =>
    clusters.slice(index + 1).some((right) => {
      const overlap =
        Math.min(Math.max(...left.ys), Math.max(...right.ys)) -
        Math.max(Math.min(...left.ys), Math.min(...right.ys))
      return (
        right.x - left.x >= pageWidth * 0.2 &&
        overlap >= pageHeight * 0.08 &&
        Math.min(left.ys.length, right.ys.length) >= 3
      )
    }),
  )

  if (plausibleColumns || gapCenters.length >= 2) {
    return { kind: 'uncertain' }
  }

  return lines.length === 0 ? { kind: 'single-column' } : { kind: 'uncertain' }
}

function reconstructColumns(items: RawPdfTextItem[], splitX: number): string {
  const left: RawPdfTextItem[] = []
  const right: RawPdfTextItem[] = []
  for (const item of items) {
    if (!item.str.trim()) continue
    const x = item.transform[4] ?? Number.NaN
    if (!Number.isFinite(x)) continue
    const column = x < splitX ? left : right
    column.push(item)
  }

  const byReadingPosition = (a: RawPdfTextItem, b: RawPdfTextItem) => {
    const yDifference = (b.transform[5] ?? 0) - (a.transform[5] ?? 0)
    return Math.abs(yDifference) > 1
      ? yDifference
      : (a.transform[4] ?? 0) - (b.transform[4] ?? 0)
  }
  const leftText = reconstructInPdfOrder(left.sort(byReadingPosition))
  const rightText = reconstructInPdfOrder(right.sort(byReadingPosition))
  return [leftText, rightText].filter(Boolean).join('\n\n')
}

function reconstructItemsInPdfOrder(items: PositionedItem[]): string {
  return reconstructInPdfOrder(
    items
      .slice()
      .sort((a, b) => a.item.index - b.item.index)
      .map((entry) => entry.item),
  )
}

function reconstructInPdfOrder(items: RawPdfTextItem[]): string {
  let text = ''
  let previous: PositionedItem | undefined

  for (const item of items) {
    const value = item.str
    if (!value) continue

    const current: PositionedItem = {
      item,
      x: item.transform[4] ?? Number.NaN,
      y: item.transform[5] ?? Number.NaN,
      fontSize: getFontSize(item),
    }
    const sameLine = previous
      ? Math.abs(current.y - previous.y) <= getLineTolerance(previous, current)
      : false

    if (previous && (!sameLine || previous.item.hasEOL)) {
      text = text.trimEnd() + '\n'
    } else if (previous && Number.isFinite(current.x)) {
      const gap = current.x - (previous.x + previous.item.width)
      const fontSize = (current.fontSize + previous.fontSize) / 2
      const wordSpaceThreshold = fontSize * 0.24
      const columnGapThreshold = Math.max(24, fontSize * 2.5)
      const hasWhitespace = /\s$/.test(text) || /^\s/.test(value)

      if (
        Number.isFinite(gap) &&
        (gap > columnGapThreshold || gap < -fontSize * 0.3)
      ) {
        text = text.trimEnd() + '\n'
      } else if (
        Number.isFinite(gap) &&
        gap >= wordSpaceThreshold &&
        !hasWhitespace
      ) {
        text += ' '
      }
    }

    text += value
    previous = current
  }

  return text.trim()
}

function reconstructLine(
  line: MutableLine,
  lineIndex: number,
  insertedSpaces: PdfTextReconstruction['insertedSpaces'],
  joinedFragments: PdfTextReconstruction['joinedFragments'],
  warnings: string[],
): ReconstructedLine {
  const items = line.items.slice().sort((a, b) => a.x - b.x)
  const runs: string[] = []
  const itemIndexes: number[] = []
  let currentRun = ''
  let previous: PositionedItem | undefined
  let lineNeedsFallback = false

  const finishRun = () => {
    if (currentRun) runs.push(currentRun)
    currentRun = ''
  }

  for (const current of items) {
    itemIndexes.push(current.item.index)
    const sourceText = current.item.str
    const text = sourceText.trim()
    if (!text) continue

    if (!previous) {
      currentRun = text
      previous = current
      continue
    }

    const gap = current.x - (previous.x + previous.item.width)
    const fontSize = (current.fontSize + previous.fontSize) / 2
    const joinThreshold = fontSize * 0.16
    const wordSpaceThreshold = fontSize * 0.24
    const columnGapThreshold = Math.max(24, fontSize * 2.5)
    const hasExplicitSpace =
      /\s$/.test(previous.item.str) || /^\s/.test(current.item.str)

    if (!Number.isFinite(gap) || !Number.isFinite(fontSize)) {
      lineNeedsFallback = true
      break
    }

    if (gap > columnGapThreshold || previous.item.hasEOL) {
      finishRun()
      currentRun = text
    } else if (hasExplicitSpace || gap >= wordSpaceThreshold) {
      currentRun += ` ${text}`
      insertedSpaces.push({
        afterItem: previous.item.index,
        beforeItem: current.item.index,
        gap,
      })
    } else if (gap <= joinThreshold && gap >= -fontSize * 0.3) {
      currentRun += text
      joinedFragments.push({
        afterItem: previous.item.index,
        beforeItem: current.item.index,
        gap,
      })
    } else {
      lineNeedsFallback = true
      break
    }
    previous = current
  }
  finishRun()

  if (lineNeedsFallback) {
    warnings.push(
      `Line ${lineIndex + 1}: geometry confidence was insufficient; PDF.js item order was retained.`,
    )
    return {
      y: line.y,
      itemIndexes,
      text: reconstructItemsInPdfOrder(items),
      runs: [reconstructItemsInPdfOrder(items)],
      usedItemOrderFallback: true,
    }
  }

  if (runs.length > 1) {
    warnings.push(
      `Line ${lineIndex + 1}: separate horizontal text runs were kept on separate lines.`,
    )
  }
  return {
    y: line.y,
    itemIndexes,
    text: runs.join('\n'),
    runs,
    usedItemOrderFallback: false,
  }
}

export function reconstructPdfText(
  rawItems: RawPdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  _legacyText?: string,
): PdfTextReconstruction {
  void _legacyText
  const geometricLines = buildGeometricLines(rawItems)
  const layout = detectMultiColumnLayout(
    rawItems,
    geometricLines,
    pageWidth,
    pageHeight,
  )
  const isMultiColumn = layout.kind === 'multi-column'
  const usedPdfJsItemOrderFallback = layout.kind === 'uncertain'
  const warnings: string[] = []
  const insertedSpaces: PdfTextReconstruction['insertedSpaces'] = []
  const joinedFragments: PdfTextReconstruction['joinedFragments'] = []
  const lines = geometricLines.map((line, index) =>
    reconstructLine(line, index, insertedSpaces, joinedFragments, warnings),
  )
  if (isMultiColumn) {
    warnings.unshift(
      'Multiple columns detected; each column was read top-to-bottom and columns were combined left-to-right.',
    )
  } else if (usedPdfJsItemOrderFallback) {
    warnings.unshift(
      'Column layout was uncertain; PDF.js item order was retained.',
    )
  }

  return {
    text: isMultiColumn
      ? reconstructColumns(rawItems, layout.splitX ?? pageWidth / 2)
      : usedPdfJsItemOrderFallback
        ? reconstructInPdfOrder(rawItems)
        : lines
            .map((line) => line.text)
            .filter(Boolean)
            .join('\n'),
    lines,
    insertedSpaces,
    joinedFragments,
    warnings,
    isMultiColumn,
    usedPdfJsItemOrderFallback,
    columnSplitX: isMultiColumn ? layout.splitX : undefined,
  }
}
