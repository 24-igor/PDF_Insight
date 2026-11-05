@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem PDF Insight release helper.
rem This script never reads, prints, or creates OPENAI_API_KEY.
rem A successful Git push triggers the GitHub Pages workflow.

cd /d "%~dp0"
echo.
echo === PDF Insight verification ===

where node >nul 2>&1 || goto :missing_node
where npm >nul 2>&1 || goto :missing_npm
where git >nul 2>&1 || goto :missing_git

call npm run typecheck || goto :failed
call npm run worker:typecheck || goto :failed
call npm test -- --run || goto :failed
call npm run lint || goto :failed
call npm run format:check || goto :failed
set "VITE_API_URL=https://pdf-insight-local.ihub24.workers.dev"
set "VITE_BASE_PATH=/PDF_Insight/"
call npm run build || goto :failed

echo.
echo Verification passed. The production frontend is in dist\.

echo.
echo === Cloudflare Worker deployment ===
call npx wrangler deploy || goto :failed

echo.
echo === Git commit and push ===
git rev-parse --show-toplevel >nul 2>&1 || goto :not_repo
git add -A

rem Never allow local secrets or generated state into the commit.
for %%F in (.dev.vars .env .env.local) do (
  git diff --cached --name-only -- "%%F" | findstr /R /C:"." >nul && (
    echo ERROR: sensitive file %%F is staged. Aborting.
    goto :failed
  )
)
git diff --cached --name-only | findstr /I /R /C:"^\.dev\.vars" /C:"^\.env$" /C:"^\.env\.local" /C:"^\.env\.production" /C:"^\.wrangler" >nul && (
  echo ERROR: a secret or generated file is staged. Aborting.
  goto :failed
)

git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to commit.
  goto :push
)

set "COMMIT_MESSAGE=%~1"
if not defined COMMIT_MESSAGE set "COMMIT_MESSAGE=chore: release PDF Insight"
git commit -m "!COMMIT_MESSAGE!" || goto :failed

:push
git push || goto :failed
goto :success

:missing_node
echo ERROR: Node.js is not available on PATH.
goto :failed
:missing_npm
echo ERROR: npm is not available on PATH.
goto :failed
:missing_git
echo ERROR: Git is not available on PATH.
goto :failed
:not_repo
echo ERROR: This folder is not inside a Git worktree.
goto :failed
:failed
echo.
echo BUILD FAILED or was cancelled. No later release step was completed.
exit /b 1
:success
echo.
echo Release helper finished.
exit /b 0
