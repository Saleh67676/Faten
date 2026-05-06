# UQU Backend Server Starter + Auto-Open Browser
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootPath

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🚀 UQU Backend Server + Frontend - Starting            ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Write-Host "🔹 Activating virtual environment..." -ForegroundColor Yellow
& ".\.venv\Scripts\Activate.ps1"

Write-Host "🔹 Moving to backend folder..." -ForegroundColor Yellow
cd backend

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║     ✅ Server is starting...                               ║" -ForegroundColor Green
Write-Host "║                                                            ║" -ForegroundColor Green
Write-Host "║     🌐 Frontend: http://localhost:8000                    ║" -ForegroundColor Green
Write-Host "║     📖 API Docs: http://localhost:8000/docs               ║" -ForegroundColor Green
Write-Host "║     🧪 Test NVIDIA: http://localhost:8000/api/            ║" -ForegroundColor Green
Write-Host "║                      diagnostics/test-nvidia              ║" -ForegroundColor Green
Write-Host "║                                                            ║" -ForegroundColor Green
Write-Host "║     ⏳ Opening browser in 2 seconds...                     ║" -ForegroundColor Green
Write-Host "║     Press Ctrl+C to stop                                  ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Start uvicorn in background process
$UvicornProcess = Start-Process -PassThru -WindowStyle Hidden -FilePath "python" -ArgumentList "-m uvicorn main:app --reload --port 8000"

# Wait 3 seconds for server to start
Start-Sleep -Seconds 3

# Open browser
Write-Host "🌐 Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:8000"

Write-Host "✅ Server is running! Press Ctrl+C to stop." -ForegroundColor Green
Write-Host ""

# Keep script running and show logs
Get-Process python | Where-Object { $_.MainWindowTitle -like "*uvicorn*" -or $_.ProcessName -eq "python" } | Wait-Process
