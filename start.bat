@echo off
setlocal

cd /d "%~dp0"

:menu
cls
echo ================================================
echo zerodha-automated-stock-updates
echo ================================================
echo.
echo 1. First-time setup
echo 2. Fetch Zerodha holdings
echo 3. Prepare manual ChatGPT packet
echo 4. Generate weekly report with PDF
echo 5. Exit
echo.
set /p choice=Choose an option: 

if "%choice%"=="1" goto setup
if "%choice%"=="2" goto fetch
if "%choice%"=="3" goto prepare
if "%choice%"=="4" goto generate
if "%choice%"=="5" goto end
goto menu

:setup
node .\src\cli.js setup
pause
goto menu

:fetch
node .\src\cli.js portfolio fetch
pause
goto menu

:prepare
node .\src\cli.js report prepare-for-chatgpt
pause
goto menu

:generate
node .\src\cli.js report generate --period weekly --include-pdf
pause
goto menu

:end
endlocal
