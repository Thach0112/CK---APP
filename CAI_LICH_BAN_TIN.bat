@echo off
chcp 65001 >nul
rem Bam dup 1 lan: dat lich 7h00 sang thu 2 - thu 6 tu tao ban tin co phieu noi bat.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dat_lich_ban_tin.ps1"
echo Da dat lich "CK Ban tin sang" luc 7h00 thu 2 - thu 6.
echo Xoa lich: schtasks /delete /tn "CK Ban tin sang" /f
pause
