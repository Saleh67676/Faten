@echo off
REM ملف تشغيل سكريبت رفع التحديثات على GitHub
REM اسم الملف: upload_github.bat

cd /d "%~dp0"
powershell -ExecutionPolicy RemoteSigned -File upload_to_github.ps1
pause
