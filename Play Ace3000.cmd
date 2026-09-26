@echo off
setlocal
cd /d "%~dp0"
python --version >nul 2>&1
if not errorlevel 1 (
    python "%~dp0serve.py" %*
    if errorlevel 1 pause
    exit /b
)
py -3 --version >nul 2>&1
if not errorlevel 1 (
    py -3 "%~dp0serve.py" %*
    if errorlevel 1 pause
    exit /b
)
echo Python 3 is needed to launch ACE 3000.
echo Install Python, then double-click this file again.
pause
exit /b 1
