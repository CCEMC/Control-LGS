@echo off
cd /d "%~dp0"
echo uukumdarlar oagi - http://localhost:8080
echo Kapatmak icin bu pencereyi kapatin.
start "" /b python -m http.server 8080 --bind 127.0.0.1
timeout /t 2 >nul
start "" "http://localhost:8080"
pause >nul
