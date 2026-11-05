# PDF Insight

Demo: https://24-igor.github.io/PDF_Insight/

![PDF Insight screenshot](./SRC_DATA/pdf.png)

Local-first application for extracting clear, structured information from PDF contracts. The interface is in Polish.

## Local development

Requirements: Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`. The local base path is `/`.

For the local analysis Worker, open a second terminal and run:

```sh
npm run worker:dev
```

Wrangler serves the Worker at `http://127.0.0.1:8787`. Keep `OPENAI_API_KEY` in the ignored `.dev.vars` file next to `wrangler.jsonc`; never add it to Vite variables or frontend code. Set `CORS_ALLOWED_ORIGINS` there as a comma-separated list of exact origins; local development defaults to the two localhost Vite origins, and production must use the exact GitHub Pages origin (never `*`). The Worker accepts `POST /analyze` with the extracted filename, page count, and page text. It does not receive the PDF binary, so the browser enforces the 10 MB PDF limit while the Worker enforces request-body and extracted-text limits.

## Architecture and decisions

- **Frontend:** React 18, TypeScript (strict), Vite, Tailwind CSS, HashRouter (`react-router-dom`), Vitest
- **Backend:** Cloudflare Worker (Wrangler) + OpenAI Responses API with strict JSON schema output
- **PDF processing:** pdf.js for client-side text extraction, Tesseract.js OCR for scanned pages, Polish language model
- **Validation:** Zod schemas for request/response; evidence grounding (numbers/dates must appear in source text)
- **Security:** Prompt-injection defense (PDF text treated as untrusted data), CORS origin allowlist, request/body/text limits, rate limiting (10 req/min per IP), no secrets in frontend code
- **Language:** Polish UI; document language detected automatically (ISO 639-1) and used for analysis output
- **Deployment:** GitHub Actions builds and deploys frontend to GitHub Pages on push to `master`; Worker deployed separately via `wrangler deploy`

## Environment variables

| Variable               | Scope                    | Example                     | Notes                                          |
| ---------------------- | ------------------------ | --------------------------- | ---------------------------------------------- |
| `VITE_API_URL`         | Vite (frontend)          | `http://127.0.0.1:8787`     | Worker endpoint; browser-safe                  |
| `VITE_BASE_PATH`       | Vite (frontend)          | `/PDF_Insight/`             | GitHub Pages base path                         |
| `OPENAI_API_KEY`       | Wrangler secret (Worker) | sk-...                      | Stored in `.dev.vars` locally; never committed |
| `CORS_ALLOWED_ORIGINS` | Wrangler var             | `https://24-igor.github.io` | Exact origins, no `*`                          |

Set `OPENAI_API_KEY` locally with:

```sh
npx wrangler secret put OPENAI_API_KEY
```

## Available checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Known limitations

- **OCR and analysis-result UI** remain later work; OCR runs for scanned pages but the structured result view is basic.
- **Long documents** are sent in full (no chunking/combining of partial results); `ANALYSIS_PAGE_LIMIT` is currently `null` (all pages).
- **History** is stored in `localStorage` only — not synced across devices or browsers.
- **Worker** is not deployed automatically by GitHub Actions; it requires manual `wrangler deploy` with `OPENAI_API_KEY` configured as a Cloudflare secret.
- **No production deployment** of the Worker is configured in CI; only the frontend is deployed to GitHub Pages.

## Current scope

Phases 1 and 2 provide the React 18, strict TypeScript, Vite, Tailwind, HashRouter, ESLint, Prettier, and Vitest foundation with a responsive Polish interface. PDF files up to 10 MB are validated and their text is extracted locally in the browser with PDF.js. Phase 3 adds the local-only Cloudflare Worker and OpenAI structured analysis endpoint.

The PDF.js worker is copied from `node_modules` into the ignored `public/pdf.worker.min.mjs` before local development and production builds. Tesseract.js, the Polish `pol` language model, and its local WebAssembly workers are copied into ignored `public/ocr/` and `public/tessdata/` directories by the same script. OCR only runs for pages with no or very little extractable text. The browser reports extraction method and low-confidence/failure warnings per page.

After extraction, choose **Analizuj dokument** to send the page text and extraction metadata to the local Worker. The original PDF stays in the browser; the local Worker forwards extracted text to OpenAI. The returned analysis includes source page and extraction method for monetary amounts and source facts, and can be downloaded as JSON.
