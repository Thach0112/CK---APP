@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Bấm đúp file này để mở trang theo dõi cổ phiếu.
rem Có Python: chạy server local (lấy giá thật từ VNDirect). Không có: mở thẳng file web (dữ liệu mẫu / CSV).
where py >nul 2>nul && (py serve.py & goto :eof)
python --version >nul 2>nul && (python serve.py & goto :eof)
echo Chua cai Python nen app se dung du lieu mau. Cai Python tai https://www.python.org/downloads/ de lay gia that.
start "" "%~dp0web\index.html"
pause
