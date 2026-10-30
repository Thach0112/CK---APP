"""Chạy web app trên máy local, kèm proxy lấy giá thật từ VNDirect (tránh lỗi CORS của trình duyệt).

Chạy: python serve.py   rồi mở http://localhost:8000
Chỉ dùng thư viện chuẩn của Python, không cần cài thêm gì.
"""
import http.server
import json
import time
import urllib.error
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
# Báo cáo tài chính theo quý cho bộ lọc FA: thử lần lượt Vietcap → TCBS → VNDirect, nguồn nào được thì dùng
VCI_GRAPHQL = "https://trading.vietcap.com.vn/data-mt/graphql"
VCI_FIELDS = ("ticker yearReport lengthReport revenue revenueGrowth netProfit netProfitGrowth roe roa pe pb eps bvps "
              "de currentRatio grossMargin netProfitMargin dividend issueShare").split()
TCBS_URL = "https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/{sym}/{kind}?yearly=0&isAll=true"
VND_RATIOS = ("https://finfo-api.vndirect.com.vn/v4/ratios/latest?filter=ratioCode:PRICE_TO_EARNINGS,PRICE_TO_BOOK,"
              "ROAE_TR_AVG5Q,ROAA_TR_AVG5Q,EPS_TR,BVPS_CR,DIVIDEND_YIELD&where=code:{sym}&order=reportDate&fields=ratioCode,value,reportDate")
FA_CACHE_SECONDS = 12 * 3600
RESOLUTIONS = {"1", "5", "15", "30", "60", "D", "W", "M"}  # D = ngày; 1/5/15… = phút (trong phiên)
CACHE_SECONDS = 15  # dashboard tự làm mới mỗi phút, cache ngắn để không gọi VNDirect dồn dập
_cache = {}


def _get_json(url, body=None, headers=None):
    h = {"User-Agent": "Mozilla/5.0", **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if data:  # GraphQL báo lỗi truy vấn kèm mã 400: vẫn đọc nội dung để biết trường nào sai
            return json.loads(e.read())
        raise


def fa_vci(sym):
    fields = list(VCI_FIELDS)
    for _ in range(4):  # trường nào nguồn không còn hỗ trợ thì bỏ đi rồi hỏi lại
        q = ("query Q($ticker: String!, $period: String!) { CompanyFinancialRatio(ticker: $ticker, period: $period) "
             "{ ratio { " + " ".join(fields) + " } period } }")
        raw = _get_json(VCI_GRAPHQL, {"query": q, "variables": {"ticker": sym, "period": "Q"}},
                        {"Referer": "https://trading.vietcap.com.vn/", "Origin": "https://trading.vietcap.com.vn"})
        bad = [f for e in raw.get("errors") or [] for f in fields if f'"{f}"' in str(e.get("message", ""))]
        if bad:
            fields = [f for f in fields if f not in bad]
            continue
        rows = ((raw.get("data") or {}).get("CompanyFinancialRatio") or {}).get("ratio") or []
        if rows:
            return {"ratio": rows}
        break
    raise ValueError("Vietcap không có dữ liệu")


def fa_tcbs(sym):
    ratio = _get_json(TCBS_URL.format(sym=sym, kind="financialratio"))
    if not isinstance(ratio, list) or not ratio:
        raise ValueError("TCBS không có dữ liệu")
    try:
        income = _get_json(TCBS_URL.format(sym=sym, kind="incomestatement"))
    except Exception:
        income = []
    return {"ratio": ratio, "income": income if isinstance(income, list) else []}


def fa_vnd(sym):
    raw = _get_json(VND_RATIOS.format(sym=sym))
    if not raw.get("data"):
        raise ValueError("VNDirect không có dữ liệu")
    return raw


FA_SOURCES = [("vci", fa_vci), ("tcbs", fa_tcbs), ("vnd", fa_vnd)]


def fundamental(sym):
    """Trả về (body JSON, status) cho /api/fundamental."""
    key = ("fa", sym)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < FA_CACHE_SECONDS:
        return hit[1], 200
    errs = []
    for name, fn in FA_SOURCES:
        try:
            body = json.dumps({"s": "ok", "source": name, "data": fn(sym)}).encode()
            _cache[key] = (time.time(), body)
            return body, 200
        except Exception as e:
            errs.append(f"{name}: {e}")
    return json.dumps({"s": "error", "error": "; ".join(errs)}).encode(), 502


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
        if url.path == "/api/fundamental":
            q = urllib.parse.parse_qs(url.query)
            sym = "".join(ch for ch in q.get("symbol", [""])[0].upper() if ch.isalnum())[:12]
            if not sym:
                return self.send_json(json.dumps({"s": "error", "error": "thiếu mã"}).encode(), 400)
            return self.send_json(*fundamental(sym))
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
