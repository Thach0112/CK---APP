# CK TA – App chứng khoán theo chỉ báo kỹ thuật

## Cấu trúc
- `web/index.html` – web app một file (HTML + JS thuần, không thư viện ngoài). Đây là bản sẽ đưa lên SharePoint.
  - Chỉ báo: MA20/50/200, EMA, RSI(14), MACD(12,26,9), Bollinger(20,2), khối lượng so với TB20.
  - Tín hiệu: 6 quy tắc, mỗi quy tắc +1/−1. Tổng ≥ 2 → MUA, ≤ −2 → BÁN, còn lại THEO DÕI.
  - Tab "Lọc cổ phiếu": chấm điểm nhiều mã, xếp theo điểm.
  - Dữ liệu: thử API VNDirect; lỗi thì dùng dữ liệu mẫu. Có thể tải file CSV (date,open,high,low,close,volume).
- `ckapp/` + `tests/` – bản Python tham chiếu của cùng bộ chỉ báo (dùng để kiểm tra số liệu; JS và Python cho kết quả trùng nhau).
- `app.py` – giao diện Streamlit (chỉ dùng khi chạy local, SharePoint không chạy được Python).

## Chạy trên máy local (khuyến nghị)
Bấm đúp `MO_APP.bat` (Windows). Hoặc tự chạy: `python serve.py` rồi mở http://localhost:8000. Server này vừa phục vụ web, vừa làm proxy lấy giá thật từ VNDirect nên không bị lỗi CORS. Chỉ cần Python 3, không cài thêm gì.

## Chạy thử nhanh
Mở `web/index.html` bằng trình duyệt (khi đó có thể chỉ có dữ liệu mẫu). Kiểm thử Python: `pip install -r requirements.txt && PYTHONPATH=. pytest`.

## Triển khai Netlify từ GitHub
1. Trên Netlify: Add new project → Import an existing project → GitHub → chọn repo `CK---APP`, nhánh `CK-APP`.
2. Không cần build command. `netlify.toml` đã khai báo: thư mục web tĩnh là `web/`, hàm lấy giá ở `netlify/functions/` (`/api/history`, `/api/symbols`).
3. Mỗi lần push lên nhánh `CK-APP`, Netlify tự triển khai lại.

`web/symbols.json` là danh sách mã lưu sẵn, dùng khi không lấy được danh sách mã mới từ VNDirect.
