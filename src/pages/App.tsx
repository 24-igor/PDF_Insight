import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { analyzePdf } from '../lib/analysis/analyzePdf'
import {
  ANALYSIS_PAGE_LIMIT,
  ANALYSIS_SCOPE,
  analysisLimitMessage,
} from '../lib/analysis/config'
import {
  AnalysisResultValidator,
  type AnalysisResult,
} from '../lib/analysis/schema'
import { extractPdfText } from '../lib/pdf/extractPdfText'
import { createStructuredDocument } from '../lib/pdf/structuredDocument'
import type {
  ExtractedPdf,
  ExtractionProgress,
  PdfValidationError,
} from '../lib/pdf/types'
import { validatePdfFile } from '../lib/pdf/validatePdf'

const validationMessages: Record<PdfValidationError, string> = {
  'wrong-type': 'Wybierz plik z rozszerzeniem .pdf.',
  'too-large': 'Plik jest za duży. Maksymalny rozmiar to 10 MB.',
  'invalid-signature': 'Ten plik nie wygląda na prawidłowy dokument PDF.',
}

function pageLabel(count: number): string {
  if (count === 1) return 'strona'
  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 12 || count % 100 > 14)
  ) {
    return 'strony'
  }
  return 'stron'
}

function injectionEvidence(page: ExtractedPdf['pages'][number]): string | null {
  const source = [page.pdfText, page.ocrText ?? ''].join(' ')
  const match = source.match(/INSTRUKCJA\s+DLA\s+SYSTEMU\s+AI:[\s\S]{0,360}/i)
  return match?.[0].replace(/\s+/g, ' ').trim() ?? null
}

type AnalysisHistoryEntry = {
  id: string
  createdAt: string
  analysis: AnalysisResult
}

const ANALYSIS_HISTORY_KEY = 'pdf-insight-analysis-history'
const MAX_HISTORY_ENTRIES = 10

function readAnalysisHistory(): AnalysisHistoryEntry[] {
  try {
    const raw = localStorage.getItem(ANALYSIS_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as Partial<AnalysisHistoryEntry>
      const analysis = AnalysisResultValidator.safeParse(candidate.analysis)
      return typeof candidate.id === 'string' &&
        typeof candidate.createdAt === 'string' &&
        analysis.success
        ? [
            {
              id: candidate.id,
              createdAt: candidate.createdAt,
              analysis: analysis.data,
            },
          ]
        : []
    })
  } catch {
    return []
  }
}

function historyLabel(entry: AnalysisHistoryEntry): string {
  const date = new Date(entry.createdAt)
  return Number.isNaN(date.valueOf())
    ? entry.createdAt
    : date.toLocaleString('pl-PL', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
}

function HomePage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progressMessage, setProgressMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractedPdf | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysisPopup, setAnalysisPopup] = useState<AnalysisResult | null>(
    null,
  )
  const [analysisHistory, setAnalysisHistory] =
    useState<AnalysisHistoryEntry[]>(readAnalysisHistory)
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null)
  const [isDocumentExpanded, setIsDocumentExpanded] = useState(false)
  const [diagnosticPageNumber, setDiagnosticPageNumber] = useState(1)
  const structuredDocument = useMemo(
    () => (result ? createStructuredDocument(result) : null),
    [result],
  )

  function goToPage(pageNumber: number) {
    setIsDocumentExpanded(true)
    setHighlightedPage(pageNumber)
    requestAnimationFrame(() => {
      document
        .getElementById(`structured-page-${pageNumber}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function updateProgress(progress: ExtractionProgress) {
    if (progress.stage === 'loading-ocr') {
      setProgressMessage('Przygotowujemy polski moduł OCR…')
    } else if (progress.stage === 'recognizing') {
      setProgressMessage(`Rozpoznajemy skan na stronie ${progress.pageNumber}…`)
    } else {
      setProgressMessage(
        `Odczytujemy stronę ${progress.pageNumber} z ${progress.totalPages}…`,
      )
    }
  }

  async function processFile(file: File) {
    setError(null)
    setResult(null)
    setAnalysis(null)
    setIsLoading(true)
    setProgressMessage('Sprawdzamy dokument…')

    try {
      const validationError = await validatePdfFile(file)
      if (validationError) {
        setError(validationMessages[validationError])
        return
      }

      setResult(await extractPdfText(file, updateProgress))
    } catch {
      setError('Nie udało się odczytać PDF. Sprawdź plik i spróbuj ponownie.')
    } finally {
      setIsLoading(false)
      setProgressMessage('')
    }
  }

  async function runAnalysis() {
    if (!result || isAnalyzing) return
    setError(null)
    setAnalysis(null)
    setIsAnalyzing(true)
    try {
      const nextAnalysis = await analyzePdf(result)
      setAnalysis(nextAnalysis)
      setAnalysisPopup(nextAnalysis)
      const nextHistory = [
        {
          id: `${Date.now()}-${nextAnalysis.document.fileName}`,
          createdAt: new Date().toISOString(),
          analysis: nextAnalysis,
        },
        ...analysisHistory,
      ].slice(0, MAX_HISTORY_ENTRIES)
      setAnalysisHistory(nextHistory)
      localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(nextHistory))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Analiza dokumentu nie powiodła się.',
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function downloadAnalysisJson(analysisToDownload = analysis) {
    if (!analysisToDownload) return
    const baseName = analysisToDownload.document.fileName.replace(/\.pdf$/i, '')
    const blob = new Blob([JSON.stringify(analysisToDownload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseName || 'pdf-insight-analysis'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function openHistoryEntry(entry: AnalysisHistoryEntry) {
    setAnalysisPopup(entry.analysis)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void processFile(file)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (isLoading || isAnalyzing) return

    const droppedFiles = event.dataTransfer.files
    if (droppedFiles.length > 1) {
      setResult(null)
      setError('Dodaj jeden plik PDF na raz.')
      return
    }

    const file = droppedFiles[0]
    if (file) void processFile(file)
  }

  return (
    <main className="main-content">
      <div className="eyebrow">
        <span className="eyebrow-dot" /> ANALIZA DOKUMENTÓW
      </div>
      <h1>
        Zacznij od treści.
        <br />
        <span>Twój PDF, czytelny tekst.</span>
      </h1>
      <p className="intro">
        Dodaj dokument PDF. Odczytamy jego strony lokalnie w przeglądarce i
        pokażemy tekst gotowy do kolejnego etapu.
      </p>

      {analysisHistory.length > 0 && (
        <section className="analysis-history" aria-labelledby="history-title">
          <div className="analysis-history-heading">
            <div>
              <span className="result-kicker">LOKALNA HISTORIA</span>
              <h2 id="history-title">Poprzednie analizy</h2>
            </div>
            <span className="document-type">{analysisHistory.length}</span>
          </div>
          <div className="analysis-history-list">
            {analysisHistory.map((entry) => (
              <button
                className="analysis-history-item"
                key={entry.id}
                type="button"
                onClick={() => openHistoryEntry(entry)}
              >
                <strong>{entry.analysis.document.fileName}</strong>
                <span>
                  {historyLabel(entry)} · {entry.analysis.document.type}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section
        className={`upload-panel${isDragging ? ' is-dragging' : ''}${isLoading || isAnalyzing ? ' is-loading' : ''}`}
        aria-labelledby="upload-title"
        onDragEnter={(event) => {
          event.preventDefault()
          if (!isLoading && !isAnalyzing) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isLoading || isAnalyzing ? (
          <div className="loading-state" role="status" aria-live="polite">
            <span className="loading-spinner" aria-hidden="true" />
            <h2 id="upload-title">
              {isAnalyzing ? 'Analizujemy dokument…' : 'Odczytujemy dokument…'}
            </h2>
            <p>
              {isAnalyzing
                ? 'Wysyłamy wyodrębniony tekst do Workera analizy.'
                : progressMessage ||
                  'Strony tekstowe i skany są czytane lokalnie.'}
            </p>
          </div>
        ) : result ? (
          <div className="result-state">
            <div className="result-heading">
              <div className="result-title-group">
                <span className="result-kicker">PDF ODCZYTANY LOKALNIE</span>
                <h2 id="upload-title">{result.fileName}</h2>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={openFilePicker}
              >
                Wybierz inny plik
              </button>
            </div>

            <div className="result-stats" aria-label="Podsumowanie odczytu">
              <div className="result-stat">
                <strong>{result.pageCount}</strong>
                <span>{pageLabel(result.pageCount)}</span>
              </div>
              <div className="result-stat">
                <strong>{result.characterCount.toLocaleString('pl-PL')}</strong>
                <span>znaków tekstu</span>
              </div>
            </div>

            {result.pageCount > ANALYSIS_PAGE_LIMIT && (
              <div className="page-warning" role="status">
                <span className="warning-icon" aria-hidden="true">
                  i
                </span>
                <div className="page-warning-content">
                  <p>
                    {analysisLimitMessage(
                      result.pageCount,
                      result.analyzedPageCount ?? result.pages.length,
                    )}
                  </p>
                </div>
              </div>
            )}

            {!result.isComplete ? (
              <div className="page-warning" role="status">
                <span className="warning-icon" aria-hidden="true">
                  !
                </span>
                <div className="page-warning-content">
                  {!result.isComplete && (
                    <p>
                      Odczyt niekompletny. Puste strony:{' '}
                      {result.emptyPageNumbers.length
                        ? result.emptyPageNumbers.map((n) => (
                            <button
                              className="page-jump"
                              key={`empty-${n}`}
                              onClick={() => goToPage(n)}
                            >
                              strona {n}
                            </button>
                          ))
                        : 'brak'}
                      ; błędy OCR:{' '}
                      {result.failedPageNumbers.length
                        ? result.failedPageNumbers.map((n) => (
                            <button
                              className="page-jump"
                              key={`failed-${n}`}
                              onClick={() => goToPage(n)}
                            >
                              strona {n}
                            </button>
                          ))
                        : 'brak'}
                      .
                    </p>
                  )}{' '}
                </div>
              </div>
            ) : null}
            {result.needsReviewPageNumbers.filter(
              (pageNumber) => !result.injectionPageNumbers.includes(pageNumber),
            ).length > 0 && (
              <div className="page-warning" role="status">
                <p>
                  Strony wymagające weryfikacji odczytu:{' '}
                  {result.needsReviewPageNumbers
                    .filter(
                      (pageNumber) =>
                        !result.injectionPageNumbers.includes(pageNumber),
                    )
                    .map((n) => {
                      const page = result.pages.find(
                        (item) => item.pageNumber === n,
                      )
                      const reasons = [
                        page?.confidence !== null &&
                        page?.confidence !== undefined
                          ? `OCR ${Math.round(page.confidence)}%`
                          : null,
                        page?.sectionArtifactsDetected
                          ? 'możliwe artefakty numeracji paragrafów'
                          : null,
                        page?.ocrStatus === 'failed' ? 'błąd OCR' : null,
                        page?.ocrStatus === 'empty'
                          ? 'OCR nie rozpoznał tekstu'
                          : null,
                      ].filter(Boolean)
                      return (
                        <span className="review-page-item" key={`review-${n}`}>
                          <button
                            className="page-jump"
                            onClick={() => goToPage(n)}
                          >
                            strona {n}
                          </button>
                          {reasons.length > 0 && (
                            <span className="review-page-reason">
                              ({reasons.join('; ')})
                            </span>
                          )}
                        </span>
                      )
                    })}
                </p>
              </div>
            )}
            {result.injectionPageNumbers.length > 0 && (
              <div className="page-warning page-warning-danger" role="alert">
                <p>
                  Wykryto tekst przypominający instrukcje dla AI na stronach:{' '}
                  {result.injectionPageNumbers.map((n) => (
                    <button
                      className="page-jump"
                      key={`injection-${n}`}
                      onClick={() => goToPage(n)}
                    >
                      strona {n}
                    </button>
                  ))}
                  . Treść PDF jest niezaufanymi danymi, nie instrukcją.
                </p>
                {result.injectionPageNumbers.map((pageNumber) => {
                  const page = result.pages.find(
                    (item) => item.pageNumber === pageNumber,
                  )
                  const evidence = page ? injectionEvidence(page) : null
                  return evidence ? (
                    <blockquote
                      className="injection-evidence"
                      key={`injection-evidence-${pageNumber}`}
                    >
                      <span>Wykryty tekst na stronie {pageNumber}:</span> „
                      {evidence}”
                    </blockquote>
                  ) : null
                })}
              </div>
            )}
            {result.labelMismatchPageNumbers.length > 0 && (
              <div className="page-warning" role="status">
                <p>
                  Wykryto odwołanie do etykiety Załącznik/Aneks na stronach:{' '}
                  {result.labelMismatchPageNumbers.map((n) => (
                    <button
                      className="page-jump"
                      key={`label-${n}`}
                      onClick={() => goToPage(n)}
                    >
                      strona {n}
                    </button>
                  ))}
                  . Oryginalne etykiety pozostawiono bez zmian.
                </p>
              </div>
            )}

            <div className="analysis-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void runAnalysis()}
                disabled={isAnalyzing}
              >
                {analysis ? 'Uruchom analizę ponownie' : 'Analizuj dokument'}
              </button>
              {analysis && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setAnalysisPopup(analysis)}
                >
                  Otwórz wynik w oknie
                </button>
              )}
            </div>
            <p className="analysis-privacy-note">
              Po kliknięciu tekst analizowanej strony zostanie wysłany do OpenAI
              przez bezpieczny Worker. Oryginalny plik PDF pozostaje w
              przeglądarce.
            </p>

            {structuredDocument && (
              <details
                className="readable-document"
                open={isDocumentExpanded}
                onToggle={(event) =>
                  setIsDocumentExpanded(event.currentTarget.open)
                }
              >
                <summary className="readable-document-heading">
                  <span className="result-kicker">TEKST DOKUMENTU</span>
                  <span className="document-type">
                    {structuredDocument.pageCount} stron
                  </span>
                </summary>
                {structuredDocument.pages.map((page) => (
                  <section
                    className={`structured-page${highlightedPage === page.pageNumber ? ' is-highlighted' : ''}`}
                    id={`structured-page-${page.pageNumber}`}
                    key={page.pageNumber}
                  >
                    <h3>Strona {page.pageNumber}</h3>
                    <pre className="markdown-document-text">
                      {page.markdownText
                        ? page.markdownText.replace(/\n{2,}/g, '\n').trim()
                        : 'Brak odczytanego tekstu.'}
                    </pre>
                  </section>
                ))}
              </details>
            )}

            {analysis && (
              <section
                className="analysis-result"
                aria-labelledby="analysis-title"
              >
                <div className="analysis-heading">
                  <div>
                    <span className="result-kicker">ANALIZA AI</span>
                    <h2 id="analysis-title">
                      {analysis.document.title || 'Wynik analizy'}
                    </h2>
                  </div>
                  <span className="document-type">
                    {analysis.document.type}
                  </span>
                </div>
                <p className="analysis-scope-note">
                  Zakres analizy:{' '}
                  {ANALYSIS_SCOPE === 'first-page'
                    ? 'pierwsza strona'
                    : `pierwsze ${ANALYSIS_PAGE_LIMIT} strony (tymczasowy limit)`}
                </p>
                <p className="analysis-summary">{analysis.summary}</p>

                <h3>Najważniejsze ustalenia</h3>
                <ul className="key-points">
                  {analysis.keyPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>

                <h3>Kwoty i źródła</h3>
                <div className="fact-list">
                  {analysis.amounts.map((amount, index) => (
                    <article
                      className="fact-card"
                      key={`${amount.value}-${amount.context}-${index}`}
                    >
                      <strong>
                        {amount.value.toLocaleString('pl-PL')} {amount.currency}
                      </strong>
                      <p>{amount.context}</p>
                      <blockquote className="source-evidence">
                        {amount.evidence}
                      </blockquote>
                      <span className="source-badge">
                        Strona {amount.sourcePage} ·{' '}
                        {amount.extractionMethod === 'ocr' ? 'OCR' : 'PDF.js'}
                      </span>
                    </article>
                  ))}
                </div>

                <h3>Fakty z dokumentu</h3>
                <div className="fact-list">
                  {analysis.sourceFacts.map((fact, index) => (
                    <article
                      className="fact-card"
                      key={`${fact.pageNumber}-${fact.fact}-${index}`}
                    >
                      <p>{fact.fact}</p>
                      <blockquote className="source-evidence">
                        {fact.evidence}
                      </blockquote>
                      <span className="source-badge">
                        Strona {fact.pageNumber} ·{' '}
                        {fact.extractionMethod === 'ocr' ? 'OCR' : 'PDF.js'}
                      </span>
                    </article>
                  ))}
                </div>

                {analysis.userCountChanges.length > 0 && (
                  <>
                    <h3>Zmiana liczby użytkowników</h3>
                    <div className="fact-list">
                      {analysis.userCountChanges.map((change, index) => (
                        <article
                          className="fact-card"
                          key={`${change.from}-${change.to}-${index}`}
                        >
                          <strong>
                            {change.from} → {change.to} użytkowników
                          </strong>
                          {change.effectiveDate && (
                            <p>Od {change.effectiveDate}</p>
                          )}
                          <blockquote className="source-evidence">
                            {change.evidence}
                          </blockquote>
                          <span className="source-badge">
                            Strona {change.sourcePage} ·{' '}
                            {change.extractionMethod === 'ocr'
                              ? 'OCR'
                              : 'PDF.js'}
                          </span>
                        </article>
                      ))}
                    </div>
                  </>
                )}

                <div className="json-result-tools">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => downloadAnalysisJson()}
                  >
                    Pobierz JSON
                  </button>
                  <details className="json-preview">
                    <summary>Podgląd JSON</summary>
                    <pre>{JSON.stringify(analysis, null, 2)}</pre>
                  </details>
                </div>
              </section>
            )}
            {import.meta.env.DEV && (
              <details className="extracted-text pdf-diagnostics">
                <summary>
                  PDF.js raw extraction diagnostics (development only)
                </summary>
                <label className="diagnostic-page-select">
                  Page
                  <select
                    value={diagnosticPageNumber}
                    onChange={(event) =>
                      setDiagnosticPageNumber(Number(event.target.value))
                    }
                  >
                    {result.pages.map((page) => (
                      <option key={page.pageNumber} value={page.pageNumber}>
                        {page.pageNumber}
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const diagnostics = result.pages.find(
                    (page) => page.pageNumber === diagnosticPageNumber,
                  )?.diagnostics
                  if (!diagnostics)
                    return <p>No PDF.js text items on this page.</p>
                  return (
                    <div className="diagnostic-content">
                      <p>
                        Page {diagnostics.pageNumber} · Size:{' '}
                        {diagnostics.pageWidth.toFixed(2)} ×{' '}
                        {diagnostics.pageHeight.toFixed(2)} pt · Text items:{' '}
                        {diagnostics.itemCount} · Approx. lines:{' '}
                        {diagnostics.lines.length}
                      </p>
                      <h4>Current legacy extraction (unchanged)</h4>
                      <pre>{diagnostics.currentText}</pre>
                      <h4>
                        Structured layout preview (heuristic, development only)
                      </h4>
                      <p>
                        Layout: {diagnostics.layout.layoutKind} · Columns:{' '}
                        {diagnostics.layout.columnCount ?? 'uncertain'} ·
                        Blocks: {diagnostics.layout.blocks.length} · Vector
                        rectangles: {diagnostics.layout.vectorRectangles.length}
                      </p>
                      {diagnostics.layout.blocks.map((block) => (
                        <article key={block.id}>
                          <strong>
                            {block.type.replaceAll('_', ' ')} ·{' '}
                            {block.confidence}
                          </strong>
                          <p>
                            Bounds: x={block.bounds.x.toFixed(1)}, y=
                            {block.bounds.y.toFixed(1)}, w=
                            {block.bounds.width.toFixed(1)}, h=
                            {block.bounds.height.toFixed(1)}
                          </p>
                          <p>{block.reason}</p>
                          <pre>
                            {block.lines.map((line) => line.text).join('\n')}
                          </pre>
                        </article>
                      ))}
                      <h4>Geometry-based reconstructed text</h4>
                      <pre>{diagnostics.reconstruction.text}</pre>
                      <h4>Detected reconstructed lines</h4>
                      {diagnostics.reconstruction.lines.map((line, index) => (
                        <pre key={`${line.y}-${line.itemIndexes[0]}`}>
                          Line {index + 1} · y={line.y.toFixed(2)} · items{' '}
                          {line.itemIndexes.join(', ')}
                          {line.usedItemOrderFallback
                            ? ' · source-order fallback'
                            : ''}
                          {'\n'}
                          {line.text}
                        </pre>
                      ))}
                      <h4>Inserted spaces</h4>
                      <pre>
                        {JSON.stringify(
                          diagnostics.reconstruction.insertedSpaces,
                          null,
                          2,
                        )}
                      </pre>
                      <h4>Joined fragments</h4>
                      <pre>
                        {JSON.stringify(
                          diagnostics.reconstruction.joinedFragments,
                          null,
                          2,
                        )}
                      </pre>
                      <h4>Reconstruction warnings</h4>
                      {diagnostics.reconstruction.warnings.length ? (
                        <ul>
                          {diagnostics.reconstruction.warnings.map(
                            (warning) => (
                              <li key={warning}>{warning}</li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p>None</p>
                      )}
                      <h4>Approximate visual lines (geometry only)</h4>
                      {diagnostics.lines.map((line) => (
                        <pre key={`${line.y}-${line.itemIndexes[0]}`}>
                          y={line.y.toFixed(2)} · items{' '}
                          {line.itemIndexes.join(', ')} · {line.text}
                        </pre>
                      ))}
                      <h4>Raw PDF.js items, original order</h4>
                      <div className="diagnostic-table-wrap">
                        <table className="diagnostic-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Text</th>
                              <th>Transform</th>
                              <th>x</th>
                              <th>y</th>
                              <th>w</th>
                              <th>h</th>
                              <th>font</th>
                              <th>EOL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagnostics.rawItems.map((item) => (
                              <tr key={item.index}>
                                <td>{item.index}</td>
                                <td>{item.str}</td>
                                <td>{JSON.stringify(item.transform)}</td>
                                <td>{item.transform[4]?.toFixed(2)}</td>
                                <td>{item.transform[5]?.toFixed(2)}</td>
                                <td>{item.width.toFixed(2)}</td>
                                <td>{item.height.toFixed(2)}</td>
                                <td>{item.fontName}</td>
                                <td>{String(item.hasEOL)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <h4>Geometry signals (diagnostic only)</h4>
                      <p>
                        Possible fragmented-word boundaries:{' '}
                        {diagnostics.possibleFragmentedWords.join(', ') ||
                          'none'}
                      </p>
                      <p>
                        Possible reading-order anomalies:{' '}
                        {diagnostics.possibleReadingOrderAnomalies.join(', ') ||
                          'none'}
                      </p>
                      <details>
                        <summary>Horizontal gaps</summary>
                        <pre>
                          {JSON.stringify(diagnostics.horizontalGaps, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )
                })()}
              </details>
            )}

            {analysisPopup && (
              <div
                className="analysis-modal-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget)
                    setAnalysisPopup(null)
                }}
              >
                <section
                  className="analysis-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="analysis-modal-title"
                >
                  <div className="analysis-modal-heading">
                    <div>
                      <span className="result-kicker">WYNIK ANALIZY</span>
                      <h2 id="analysis-modal-title">
                        {analysisPopup.document.title ||
                          analysisPopup.document.fileName}
                      </h2>
                      <p>
                        {analysisPopup.document.fileName} ·{' '}
                        {analysisPopup.document.type}
                      </p>
                    </div>
                    <button
                      className="modal-close"
                      type="button"
                      aria-label="Zamknij wynik analizy"
                      onClick={() => setAnalysisPopup(null)}
                    >
                      ×
                    </button>
                  </div>
                  <p className="analysis-summary">{analysisPopup.summary}</p>
                  <h3>Najważniejsze ustalenia</h3>
                  <ul className="key-points">
                    {analysisPopup.keyPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <div className="json-result-tools modal-tools">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => downloadAnalysisJson(analysisPopup)}
                    >
                      Pobierz JSON
                    </button>
                    <details className="json-preview">
                      <summary>Podgląd JSON</summary>
                      <pre>{JSON.stringify(analysisPopup, null, 2)}</pre>
                    </details>
                  </div>
                </section>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="upload-icon" aria-hidden="true">
              ↑
            </div>
            <h2 id="upload-title">Przeciągnij PDF tutaj</h2>
            <p>albo wybierz go z urządzenia</p>
            <button
              className="primary-button"
              type="button"
              onClick={openFilePicker}
            >
              Wybierz plik PDF
            </button>
            <p className="file-requirements">PDF · maks. 10 MB</p>
          </>
        )}
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".pdf,application/pdf"
          aria-label="Wybierz plik PDF"
          onChange={handleFileChange}
        />
      </section>

      {error && (
        <div className="error-message" role="alert">
          <p>{error}</p>
          {result && !isLoading && !isAnalyzing && (
            <button
              className="secondary-button error-retry"
              type="button"
              onClick={() => void runAnalysis()}
            >
              Spróbuj ponownie
            </button>
          )}
        </div>
      )}

      {!result && !isLoading && (
        <p className="privacy-note">
          PDF jest odczytywany lokalnie. Po wybraniu analizy sam tekst stron
          trafia do OpenAI przez bezpieczny Worker; oryginalny plik PDF nie jest
          wysyłany.
        </p>
      )}
    </main>
  )
}

function NotFoundPage() {
  return (
    <main className="main-content">
      <h1>Nie znaleziono strony</h1>
      <Link to="/">Wróć na stronę główną</Link>
    </main>
  )
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="PDF Insight — strona główna">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>
            PDF <strong>Insight</strong>
          </span>
        </Link>
        <span className="header-caption">Twoje dokumenty, jaśniej.</span>
      </header>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <footer className="site-footer">
        PDF Insight <span>·</span> Prosta analiza ważnych dokumentów
      </footer>
    </div>
  )
}
