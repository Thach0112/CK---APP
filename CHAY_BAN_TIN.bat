@echo off
chcp 65001 >nul
rem Tao ban tin co phieu noi bat va mo tren trinh duyet (lich 7h sang cung goi file nay)
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% ban_tin.py %*
if errorlevel 1 timeout /t 60
