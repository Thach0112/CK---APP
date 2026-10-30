# CK Tự Động – App lọc cổ phiếu theo phân tích kỹ thuật (TA) và cơ bản (FA)

## Cấu trúc
- `web/index.html` – web app một file (HTML + JS thuần, không thư viện ngoài). Đây là bản sẽ đưa lên SharePoint.
  - Chỉ báo: MA20/50/200, EMA, RSI(14), MACD(12,26,9), Bollinger(20,2), khối lượng so với TB20.
  - Tín hiệu: 6 quy tắc, mỗi quy tắc +1/−1. Tổng ≥ 2 → MUA, ≤ −2 → BÁN, còn lại THEO DÕI.
  - Tab "Lọc cổ phiếu": chấm điểm nhiều mã, xếp theo điểm.
  - Kiểm định (`web/backtest.js`, cuối tab biểu đồ): chạy lại 7 chiến lược mua/bán trên 1, 3 hoặc 5 năm dữ liệu của mã đang xem, so với mua và giữ, chỉ ra chiến lược hợp nhất và việc cần làm phiên tới. Có tính phí 0,15%/chiều, thuế bán 0,1%, T+2 và cắt lỗ.
  - Dữ liệu: thử API VNDirect; lỗi thì dùng dữ liệu mẫu. Có thể tải file CSV (date,open,high,low,close,volume).
- Bộ lọc FA (`web/fa.js`): lấy báo cáo tài chính theo quý qua `/api/fundamental` (thử lần lượt Vietcap → TCBS → VNDirect), tính P/E, P/B theo giá hiện tại và EPS 4 quý, PEG, ROE, ROA, D/E, biên lợi nhuận, tăng trưởng doanh thu/LNST so với cùng kỳ.
  - 19 tiêu chí chia 4 nhóm: Định giá, Tăng trưởng, Hiệu quả & sức khoẻ tài chính, Cảnh báo cơ bản xấu.
  - Tiêu chí FA là điều kiện bắt buộc (phải đạt tất cả), tiêu chí TA xét theo "Cách lọc". FA chỉ tải cho các mã đã qua bước TA, lưu 12 giờ trong trình duyệt.
  - Bộ lọc mẫu kết hợp: "Khuyến nghị FA + TA", "CANSLIM", Graham, Chất lượng, GARP, Tăng trưởng mạnh.
  - Bảng kết quả có thêm cột P/E, P/B, ROE, LN quý; tab biểu đồ có khối "Chỉ số cơ bản (FA)".
- `ckapp/` + `tests/` – bản Python tham chiếu của cùng bộ chỉ báo (dùng để kiểm tra số liệu; JS và Python cho kết quả trùng nhau).
- `app.py` – giao diện Streamlit (chỉ dùng khi chạy local, SharePoint không chạy được Python).

## Chạy trên máy local (khuyến nghị)
Bấm đúp `MO_APP.bat` (Windows). Hoặc tự chạy: `python serve.py` rồi mở http://localhost:8000. Server này vừa phục vụ web, vừa làm proxy lấy giá thật từ VNDirect nên không bị lỗi CORS. Chỉ cần Python 3, không cài thêm gì.

## Chạy thử nhanh
Mở `web/index.html` bằng trình duyệt (khi đó có thể chỉ có dữ liệu mẫu). Kiểm thử Python: `pip install -r requirements.txt && PYTHONPATH=. pytest`. Kiểm thử phần kiểm định: `node --test tests/backtest.test.js tests/fa.test.js`.

## Triển khai Netlify từ GitHub
1. Trên Netlify: Add new project → Import an existing project → GitHub → chọn repo `CK---APP`, nhánh `CK-APP`.
2. Không cần build command. `netlify.toml` đã khai báo: thư mục web tĩnh là `web/`, hàm lấy giá ở `netlify/functions/` (`/api/history`, `/api/symbols`, `/api/fundamental`).
3. Mỗi lần push lên nhánh `CK-APP`, Netlify tự triển khai lại.

`web/symbols.json` là danh sách mã lưu sẵn, dùng khi không lấy được danh sách mã mới từ VNDirect.
