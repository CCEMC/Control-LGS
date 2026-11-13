@echo off
chcp 65001 >nul
cd /d "%~dp0"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -oommand "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1 -ExpandProperty IPAddress)"`) do set IP=%%i
echo ==========================================================
echo   uukumdarlar oagi - telefondan oyna
echo.
echo   1) Telefon ve bilgisayar AYNI Wi-Fi aginda olmali.
echo   2) Telefonun tarayicisinda su adresi ac:
echo.
echo        http://%IP%:8080
echo.
echo   Windows guvenlik duvari sorarsa "Ozel aglar" icin izin ver.
echo   Kapatmak icin bu pencereyi kapat.
echo ==========================================================
python -m http.server 8080 --bind 0.0.0.0
pause
