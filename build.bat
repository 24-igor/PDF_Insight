@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem PDF Insight release helper.
rem This script never reads, prints, or creates OPENAI_API_KEY.
rem Frontend publishing is intentionally opt-in; a normal Git push is the
rem publish step only when the repository already has a GitHub Pages workflow.

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
call npm run build || goto :failed

echo.
echo Verification passed. The production frontend is in dist\.

set "DEPLOY_BACKEND=N"
set /p "DEPLOY_BACKEND=Deploy the Cloudflare Worker now? (y/N): "
if /I "!DEPLOY_BACKEND!"=="Y" (
  echo.
  echo === Cloudflare Worker deployment ===
  echo Ensure OPENAI_API_KEY is already configured with:
  echo   npx wrangler secret put OPENAI_API_KEY --name pdf-insight-local
  set "CONFIRM_DEPLOY=N"
  set /p "CONFIRM_DEPLOY=Continue with wrangler deploy? (y/N): "
  if /I "!CONFIRM_DEPLOY!"=="Y" (
    call npx wrangler deploy || goto :failed
  ) else (
    echo Worker deployment skipped.
  )
) else (
  echo Worker deployment skipped.
)

set "PUBLISH_FRONTEND=N"
if exist ".github\workflows" (
  echo A GitHub Actions workflow directory exists. A normal push may publish the frontend.
) else (
  echo No GitHub Pages workflow was found. The frontend was built but not published.
)
set /p "PUBLISH_FRONTEND=Commit and push the verified changes? (y/N): "
if /I not "!PUBLISH_FRONTEND!"=="Y" (
  echo Commit and push skipped.
  goto :success
)

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

set "COMMIT_MESSAGE="
set /p "COMMIT_MESSAGE=Commit message (required): "
if not defined COMMIT_MESSAGE (
  echo A commit message is required.
  goto :failed
)
git commit -m "!COMMIT_MESSAGE!" || goto :failed

:push
set "PUSH_NOW=N"
set /p "PUSH_NOW=Push the commit to the configured remote? (y/N): "
if /I "!PUSH_NOW!"=="Y" (
  git push || goto :failed
) else (
  echo Push skipped. The commit remains local.
)
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
