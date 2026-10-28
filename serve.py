"""Chạy web app trên máy local, kèm proxy lấy giá thật từ VNDirect (tránh lỗi CORS của trình duyệt).

Chạy: python serve.py   rồi mở http://localhost:8000
Chỉ dùng thư viện chuẩn của Python, không cần cài thêm gì.
"""
import http.server
import json
import time
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

PORT = 8000
WEB_DIR = Path(__file__).parent / "web"
VNDIRECT_URL = "https://dchart-api.vndirect.com.vn/dchart/history"
# Danh sách toàn bộ mã niêm yết (HOSE, HNX, UPCoM) cho bộ lọc toàn thị trường
SYMBOLS_URLS = [
    "https://dchart-api.vndirect.com.vn/dchart/search?limit=5000&query=&type=stock&exchange=",
    "https://finfo-api.vndirect.com.vn/v4/stocks?q=type:stock~status:listed&fields=code,floor,type,status&size=3000",
    "https://finfo-api.vndirect.com.vn/v4/stocks?q=type:STOCK~status:LISTED&fields=code,floor,type,status&size=3000",
]
RESOLUTIONS = {"1", "5", "15", "30", "60", "D", "W", "M"}  # D = ngày; 1/5/15… = phút (trong phiên)
CACHE_SECONDS = 15  # dashboard tự làm mới mỗi phút, cache ngắn để không gọi VNDirect dồn dập
_cache = {}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def send_json(self, body, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def symbols(self):
        hit = _cache.get("symbols")
        if hit and time.time() - hit[0] < 86400:
            return self.send_json(hit[1])
        err = "không rõ"
        for u in SYMBOLS_URLS:
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    raw = json.loads(r.read())
                rows = raw.get("data", []) if isinstance(raw, dict) else raw
                # dchart/search trả về dạng UDF: {symbol, exchange, type}; finfo trả về {code, floor}
                rows = [{"code": x.get("code") or x.get("symbol", ""), "floor": x.get("floor") or x.get("exchange", "")} for x in rows]
                out = sorted({(x["code"].upper(), str(x.get("floor", "")).upper().replace("HSX", "HOSE")) for x in rows
                              if len(x.get("code", "")) == 3 and str(x.get("floor", "")).upper().replace("HSX", "HOSE") in ("HOSE", "HNX", "UPCOM")})
                if len(out) > 300:
                    body = json.dumps({"s": "ok", "data": [{"code": c, "floor": f} for c, f in out]}).encode()
                    _cache["symbols"] = (time.time(), body)
                    return self.send_json(body)
                err = f"chỉ nhận được {len(out)} mã"
            except Exception as e:
                err = str(e)
        self.send_json(json.dumps({"s": "error", "error": err}).encode(), 502)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/symbols":
            return self.symbols()
        if url.path != "/api/history":
            return super().do_GET()
        q = urllib.parse.parse_qs(url.query)
        symbol = "".join(ch for ch in q.get("symbol", ["FPT"])[0].upper() if ch.isalnum())[:12] or "FPT"
        days = min(max(int(q.get("days", ["500"])[0]) if q.get("days", ["500"])[0].isdigit() else 500, 1), 3000)
        resolution = q.get("resolution", ["D"])[0].upper()
        if resolution not in RESOLUTIONS:
            resolution = "D"
        key = (symbol, days, resolution)
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            body, status = hit[1], 200
        else:
            now = int(time.time())
            params = urllib.parse.urlencode({"resolution": resolution, "symbol": symbol, "from": now - days * 86400, "to": now})
            try:
                req = urllib.request.Request(f"{VNDIRECT_URL}?{params}", headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    body, status = r.read(), 200
                _cache[key] = (time.time(), body)
            except Exception as e:
                body, status = json.dumps({"s": "error", "error": str(e)}).encode(), 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # bớt log mỗi lần gọi API
        if "/api/" not in self.path:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"Mở http://localhost:{PORT}  (Ctrl+C để dừng)")
    webbrowser.open(f"http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
