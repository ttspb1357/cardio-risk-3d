@echo off
rem CardioRisk 3D - double-click to start.
rem First start: creates a Python environment and installs the packages (needs internet, a few minutes),
rem and builds the website if it is not included yet (needs Node.js). Later starts take a few seconds.
rem Optional: set PORT=8001 before running to use another port.
setlocal EnableExtensions
cd /d "%~dp0"
title CardioRisk 3D
if not defined PORT set "PORT=8000"

rem ---- 1. Python environment (first start only) ----------------------------------------------
if exist ".venv\Scripts\python.exe" goto :have_venv
call :find_python
if not defined PY goto :no_python
echo.
echo First start: installing the Python packages with %PY%.
echo This takes a few minutes and needs an internet connection.
echo.
%PY% -m venv .venv || goto :fail
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q --upgrade pip
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt || goto :fail_pip
:have_venv

rem ---- 2. Website (already built inside the demo ZIP) ------------------------------------------
if exist "frontend\dist\index.html" goto :have_site
where npm >nul 2>nul || goto :no_node
echo.
echo Building the website...
pushd frontend
call npm ci --no-audit --no-fund || goto :fail_popd
call npm run build || goto :fail_popd
popd
:have_site

rem ---- 3. Start ---------------------------------------------------------------------------------
echo.
echo  CardioRisk 3D is starting at http://127.0.0.1:%PORT%
echo  The browser opens by itself when it is ready.
echo  Keep this window open while you use the app. Close it to stop.
echo.
if not defined CARDIO_NO_BROWSER start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest 'http://127.0.0.1:%PORT%/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://127.0.0.1:%PORT%'; break } catch { Start-Sleep 1 } }"
".venv\Scripts\python.exe" -m uvicorn backend.app:app --port %PORT%
echo.
echo The app has stopped. If the message above says the address is already in use, CardioRisk 3D
echo is probably already running in another window: use that one, or close it and start again.
pause
exit /b

rem ---- helpers ------------------------------------------------------------------------------------
:find_python
rem Prefer the tested version (3.10) even when newer versions are installed.
set "PY="
for %%v in (3.10 3.11 3.12 3.13) do if not defined PY (py -%%v -c "exit()" >nul 2>nul && set "PY=py -%%v")
if defined PY exit /b
python -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)" >nul 2>nul && set "PY=python"
exit /b

:no_python
echo.
echo A suitable Python was not found. Python 3.10 to 3.13 work; 3.14 is too new for some packages.
echo Install Python 3.10 from https://www.python.org/downloads/release/python-31011/
echo and tick "Add python.exe to PATH" on the first screen. Then start this file again.
echo.
pause
exit /b 1

:no_node
echo.
echo The website has not been built yet, and building it needs Node.js.
echo Install the LTS version from https://nodejs.org/ and start this file again.
echo (The demo ZIP already contains the built website, so this is only needed for a GitHub copy.)
echo.
pause
exit /b 1

:fail_pip
echo.
echo Installing the Python packages failed. Check the internet connection and start this file again.
echo If it keeps failing, install Python 3.10 (see above): it is the tested version.
rmdir /s /q .venv >nul 2>nul
pause
exit /b 1

:fail_popd
popd
:fail
echo.
echo Setup failed: see the messages above.
pause
exit /b 1
