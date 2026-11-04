import { MAX_PDF_SIZE_BYTES, type PdfValidationError } from './types'

const PDF_SIGNATURE = '%PDF-'

export async function validatePdfFile(
  file: File,
): Promise<PdfValidationError | null> {
  if (file.size > MAX_PDF_SIZE_BYTES) {
    return 'too-large'
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return 'wrong-type'
  }

  const header = await file.slice(0, PDF_SIGNATURE.length).text()
  if (header !== PDF_SIGNATURE) {
    return 'invalid-signature'
  }

  return null
}
