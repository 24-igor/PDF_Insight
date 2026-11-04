import { describe, expect, it } from 'vitest'
import { MAX_PDF_SIZE_BYTES } from './types'
import { validatePdfFile } from './validatePdf'

describe('validatePdfFile', () => {
  it('accepts a PDF with a valid signature and extension', async () => {
    const file = new File(['%PDF-1.7\nDocument'], 'contract.PDF', {
      type: 'application/pdf',
    })

    await expect(validatePdfFile(file)).resolves.toBeNull()
  })

  it('rejects files without a PDF extension', async () => {
    const file = new File(['%PDF-1.7'], 'contract.txt')

    await expect(validatePdfFile(file)).resolves.toBe('wrong-type')
  })

  it('rejects a PDF extension when the file signature is invalid', async () => {
    const file = new File(['not a PDF'], 'contract.pdf')

    await expect(validatePdfFile(file)).resolves.toBe('invalid-signature')
  })

  it('rejects files larger than 10 MB', async () => {
    const file = new File([new Uint8Array(MAX_PDF_SIZE_BYTES + 1)], 'large.pdf')

    await expect(validatePdfFile(file)).resolves.toBe('too-large')
  })

  it('accepts a PDF at the 10 MB limit', async () => {
    const file = new File(
      ['%PDF-', new Uint8Array(MAX_PDF_SIZE_BYTES - 5)],
      'at-limit.pdf',
    )

    await expect(validatePdfFile(file)).resolves.toBeNull()
  })
})
