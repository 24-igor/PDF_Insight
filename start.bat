@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

echo ==========================================
echo   PDF Insight — Local Development Start
echo ==========================================
echo.

:: Check Node.js and npm
where node >nul 2>&1 || (
    echo ERROR: Node.js is not available on PATH.
    goto :failed
)
where npm >nul 2>&1 || (
    echo ERROR: npm is not available on PATH.
    goto :failed
)

:: Start Cloudflare Worker in a new console window
echo [1/3] Starting Cloudflare Worker (http://127.0.0.1:8787)...
start "PDF Insight Worker" cmd /c "npm run worker:dev"

:: Give the worker a moment to bind
timeout /t 3 >nul

:: Start Vite dev server in a new console window (predev copies pdf worker automatically)
echo [2/3] Starting Vite dev server (http://localhost:5173)...
start "PDF Insight App" cmd /c "npm run dev"

:: Give vite a moment to bind
timeout /t 5 >nul

:: Open the local site in the default browser
echo [3/3] Opening http://localhost:5173 in your browser...
start "" "http://localhost:5173"

echo.
echo ==========================================
echo   Both services are starting.
echo   Worker:  http://127.0.0.1:8787
echo   App:     http://localhost:5173
echo   Check the two console windows above for logs.
echo ==========================================
echo.
goto :end

:failed
echo.
echo Press any key to exit...
pause >nul

:end
endlocal