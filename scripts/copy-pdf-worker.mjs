import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workerSource = resolve(
  projectRoot,
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
)
const publicDirectory = resolve(projectRoot, 'public')
const workerDestination = resolve(publicDirectory, 'pdf.worker.min.mjs')

await mkdir(publicDirectory, { recursive: true })
await copyFile(workerSource, workerDestination)

const tesseractWorkerSource = resolve(
  projectRoot,
  'node_modules/tesseract.js/dist/worker.min.js',
)
const tesseractCoreDirectory = resolve(
  projectRoot,
  'node_modules/tesseract.js-core',
)
const tesseractAssets = resolve(publicDirectory, 'ocr')
const tesseractCoreAssets = resolve(tesseractAssets, 'core')
const polishDataSource = resolve(
  projectRoot,
  'node_modules/@tesseract.js-data/pol/4.0.0_best_int/pol.traineddata.gz',
)

await mkdir(tesseractCoreAssets, { recursive: true })
await mkdir(resolve(publicDirectory, 'tessdata'), { recursive: true })
await copyFile(tesseractWorkerSource, resolve(tesseractAssets, 'worker.min.js'))
await copyFile(
  polishDataSource,
  resolve(publicDirectory, 'tessdata/pol.traineddata.gz'),
)

for (const fileName of [
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  await copyFile(
    resolve(tesseractCoreDirectory, fileName),
    resolve(tesseractCoreAssets, fileName),
  )
}
