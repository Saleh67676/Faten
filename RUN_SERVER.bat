@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║     🚀 UQU Backend Server + Frontend - Starting            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo 🔹 Activating virtual environment...
call .venv\Scripts\activate.bat

echo 🔹 Moving to backend folder...
cd backend

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║     ✅ Server is starting...                               ║
echo ║                                                            ║
echo ║     🌐 Frontend: http://localhost:8000                    ║
echo ║     📖 API Docs: http://localhost:8000/docs               ║
echo ║     🧪 Test NVIDIA: http://localhost:8000/api/            ║
echo ║                      diagnostics/test-nvidia              ║
echo ║                                                            ║
echo ║     ⏳ Opening browser in 2 seconds...                     ║
echo ║     Press Ctrl+C to stop                                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Wait 2 seconds
timeout /t 2 /nobreak > nul

REM Open browser
start http://localhost:8000

echo.
echo ✅ Server is running!
echo 🔗 Browser opened: http://localhost:8000
echo.
echo 📝 Press Ctrl+C in this window to stop the server
echo.

REM Run server in foreground
python -m uvicorn main:app --reload --port 8000

REM After Ctrl+C
echo.
echo 👋 Server stopped.
echo.
