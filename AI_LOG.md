# AI work log

## Phase 1 — local foundation

- Added the React 18 and Vite application shell with strict TypeScript settings and hash-based routing.
- Added Tailwind, ESLint, Prettier, and Vitest configuration.
- Kept the application local-only with Vite base `/`; no production configuration or deployment was added.
- Restored package installation after confirming the execution sandbox blocks outbound DNS and network access; elevated npm connectivity to `registry.npmjs.org` works, so no npm proxy, registry, or TLS setting needed changes.
- Generated `package-lock.json` from the current manifest. Git confirmed the old lockfile was not tracked because the parent repository ignores `APPS/*`.
- Validation passed: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` (1 test), and `npm run build`.
- Started Vite locally and confirmed `http://127.0.0.1:5173/` returns HTTP 200 with the Polish page title and root mount element.

Status: **COMPLETE — Phase 1 only.** No Phase 2 work or production deployment was started.

## Phase 2 — local PDF reading

- Added local PDF validation for the `.pdf` extension, `%PDF-` signature, and 10 MB maximum.
- Added drag-and-drop and file-picker upload, browser-side text extraction by page with PDF.js, and a Polish warning listing pages without extractable text.
- Added a worker-copy script for development/build; the copied worker is ignored as a generated dependency artifact.
- Validation passed: TypeScript, ESLint, Prettier, Vitest (6 tests), and production build.
- Local test PDF check: 12 pages, 21,767 extracted characters, page 11 had no extractable text. The local UI displayed the page count and page 11 warning.
- Environment checked: **local**. No Worker, API, deployment, or OCR was used.

Status: **COMPLETE — Phase 2 only.**

## Phase 3 — local Worker and OpenAI integration

- Added a local-only Wrangler Worker at `worker/src/index.ts` with `POST /analyze`; it accepts extracted page text and metadata, not PDF binaries.
- Added Zod request/result validation, strict OpenAI Responses API JSON Schema output, a single retry after invalid model output, and Polish error messages.
- Added prompt-injection handling that explicitly treats all PDF text as untrusted document data, plus request-size/page/text limits, localhost CORS, method checks, and a bounded in-memory local rate limit.
- Kept `OPENAI_API_KEY` in ignored `.dev.vars`; no key was added to frontend variables or source. `.dev.vars.example` contains only the variable name.
- Added `wrangler.jsonc`, generated Worker environment types with Wrangler, and synchronized the lockfile with Wrangler and Zod. A retry after `npm ping` succeeded resolved the temporary registry DNS failure. No registry or TLS settings were changed.
- End-to-end local OpenAI smoke test passed with a synthetic Polish prompt-injection sample: valid structured response, correct document metadata, and the model did not follow the embedded `PWNED` instruction.
- Worker protections passed local checks: 405 method rejection, 400 invalid JSON, 403 foreign origin, 404 unknown route, 413 oversized body, and 429 on the 11th same-client request within a minute.
- Validation passed: Worker TypeScript check, app TypeScript check, ESLint, Prettier, Vitest (6 tests), and production build. The local Vite app returned HTTP 200 with its page title and root mount element. Wrangler remained available locally at `http://127.0.0.1:8787`; it logs a harmless offline warning when optional `Request.cf` metadata cannot be fetched.
- `npm audit` reports 17 advisories (15 moderate, 2 critical) in the dependency tree, including the current Vitest major line and related test tooling. No major-version audit fix was applied as part of this phase.
- No deployment command was run.

Status: **COMPLETE — Phase 3 only. Phase 4 not started.**
