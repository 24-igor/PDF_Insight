import { z } from 'zod'

export const AnalyzeRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  pageCount: z.number().int().min(1).max(500),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1),
        text: z.string().max(20_000),
        extractionMethod: z.enum(['pdfjs', 'ocr', 'none']),
        confidence: z.number().min(0).max(100).nullable(),
      }),
    )
    .min(1)
    .max(500),
})

export const AnalysisResultValidator = z.object({
  document: z.object({
    fileName: z.string(),
    pages: z.number().int(),
    language: z.string().length(2),
    type: z.enum(['faktura', 'umowa', 'oferta', 'raport', 'inne']),
    title: z.string().nullable(),
    date: z.iso.date().nullable(),
  }),
  summary: z.string(),
  keyPoints: z.array(z.string()).min(3).max(7),
  entities: z.object({
    organizations: z.array(z.string()),
    people: z.array(z.string()),
  }),
  amounts: z.array(
    z.object({
      value: z.number(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      context: z.string(),
      evidence: z.string().min(8),
      sourcePage: z.number().int().min(1),
      extractionMethod: z.enum(['pdfjs', 'ocr']),
    }),
  ),
  dates: z.array(
    z.object({
      date: z.iso.date(),
      context: z.string(),
      evidence: z.string().min(8),
      sourcePage: z.number().int().min(1),
      extractionMethod: z.enum(['pdfjs', 'ocr']),
    }),
  ),
  keywords: z.array(z.string()),
  sourceFacts: z
    .array(
      z.object({
        fact: z.string(),
        evidence: z.string().min(8),
        pageNumber: z.number().int().min(1),
        extractionMethod: z.enum(['pdfjs', 'ocr']),
      }),
    )
    .min(1)
    .max(20),
  userCountChanges: z.array(
    z.object({
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      effectiveDate: z.iso.date().nullable(),
      evidence: z.string().min(8),
      sourcePage: z.number().int().min(1),
      extractionMethod: z.enum(['pdfjs', 'ocr']),
    }),
  ),
})

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>
export type AnalysisResult = z.infer<typeof AnalysisResultValidator>

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'document',
    'summary',
    'keyPoints',
    'entities',
    'amounts',
    'dates',
    'keywords',
    'sourceFacts',
    'userCountChanges',
  ],
  properties: {
    document: {
      type: 'object',
      additionalProperties: false,
      required: ['fileName', 'pages', 'language', 'type', 'title', 'date'],
      properties: {
        fileName: { type: 'string' },
        pages: { type: 'integer' },
        language: { type: 'string', minLength: 2, maxLength: 2 },
        type: {
          type: 'string',
          enum: ['faktura', 'umowa', 'oferta', 'raport', 'inne'],
        },
        title: { type: ['string', 'null'] },
        date: {
          anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
        },
      },
    },
    summary: { type: 'string' },
    keyPoints: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: { type: 'string' },
    },
    entities: {
      type: 'object',
      additionalProperties: false,
      required: ['organizations', 'people'],
      properties: {
        organizations: { type: 'array', items: { type: 'string' } },
        people: { type: 'array', items: { type: 'string' } },
      },
    },
    amounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'value',
          'currency',
          'context',
          'evidence',
          'sourcePage',
          'extractionMethod',
        ],
        properties: {
          value: { type: 'number' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          context: { type: 'string' },
          evidence: { type: 'string', minLength: 8 },
          sourcePage: { type: 'integer', minimum: 1 },
          extractionMethod: { type: 'string', enum: ['pdfjs', 'ocr'] },
        },
      },
    },
    dates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'date',
          'context',
          'evidence',
          'sourcePage',
          'extractionMethod',
        ],
        properties: {
          date: { type: 'string', format: 'date' },
          context: { type: 'string' },
          evidence: { type: 'string', minLength: 8 },
          sourcePage: { type: 'integer', minimum: 1 },
          extractionMethod: { type: 'string', enum: ['pdfjs', 'ocr'] },
        },
      },
    },
    keywords: { type: 'array', items: { type: 'string' } },
    sourceFacts: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fact', 'evidence', 'pageNumber', 'extractionMethod'],
        properties: {
          fact: { type: 'string' },
          evidence: { type: 'string', minLength: 8 },
          pageNumber: { type: 'integer', minimum: 1 },
          extractionMethod: { type: 'string', enum: ['pdfjs', 'ocr'] },
        },
      },
    },
    userCountChanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'from',
          'to',
          'effectiveDate',
          'evidence',
          'sourcePage',
          'extractionMethod',
        ],
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 0 },
          effectiveDate: {
            anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }],
          },
          evidence: { type: 'string', minLength: 8 },
          sourcePage: { type: 'integer', minimum: 1 },
          extractionMethod: { type: 'string', enum: ['pdfjs', 'ocr'] },
        },
      },
    },
  },
} as const
