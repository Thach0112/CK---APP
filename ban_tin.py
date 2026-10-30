"""Bản tin cổ phiếu nổi bật buổi sáng: quét toàn thị trường (HOSE, HNX, UPCoM), lọc mã có tín hiệu
MUA/BÁN theo tiêu chí TA, kèm vài ghi chú thị trường. Ghi ra file HTML trong thư mục ban_tin/ và mở bằng trình duyệt.

Chạy: py ban_tin.py              (mặc định chỉ xét mã có GTGD TB20 ≥ 3 tỷ)
      py ban_tin.py --gtgd 5     (đổi ngưỡng thanh khoản, đơn vị tỷ đồng)
      py ban_tin.py --khong-mo   (chỉ ghi file, không mở trình duyệt)
Chỉ dùng thư viện chuẩn của Python. Lịch chạy tự động: CAI_LICH_BAN_TIN.bat.
"""
import argparse
import html
import json
import time
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
OUT_DIR = ROOT / "ban_tin"
VNDIRECT_URL = "https://dchart-api.vndirect.com.vn/dchart/history"
VN_TZ = timezone(timedelta(hours=7))
INDEXES = [("VNINDEX", "VN-Index"), ("VN30", "VN30"), ("HNX", "HNX-Index"), ("UPCOM", "UPCoM-Index")]
N_CROSS = 3  # tín hiệu giao cắt tính trong 3 phiên gần nhất


def fetch(symbol, days=420, tries=3):
    """Giá ngày từ VNDirect: list các phiên {t, o, h, l, c, v}; giá tính bằng nghìn đồng."""
    now = int(time.time())
    url = f"{VNDIRECT_URL}?resolution=D&symbol={symbol}&from={now - days * 86400}&to={now}"
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                j = json.loads(r.read())
            if j.get("s") != "ok" or not j.get("t"):
                return None
            return [dict(t=t, o=o, h=h, l=l, c=c, v=v) for t, o, h, l, c, v in zip(j["t"], j["o"], j["h"], j["l"], j["c"], j["v"])]
        except Exception:
            time.sleep(1 + k)
    return None


def sma(xs, n):
    out, s = [None] * len(xs), 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def cross_up(a, b, i):
    return None not in (a[i], b[i], a[i - 1], b[i - 1]) and a[i] > b[i] and a[i - 1] <= b[i - 1]


def cross_dn(a, b, i):
    return None not in (a[i], b[i], a[i - 1], b[i - 1]) and a[i] < b[i] and a[i - 1] >= b[i - 1]


def within(L, f, n=N_CROSS):
    return any(f(i) for i in range(L, max(L - n, 0), -1))


def analyze(sym, floor, bars):
    """Tính chỉ báo ở phiên cuối và trả về các tín hiệu MUA/BÁN (giống tiêu chí trong tab Lọc cổ phiếu)."""
    if not bars or len(bars) < 110:
        return None
    c = [b["c"] for b in bars]
    v = [b["v"] for b in bars]
    L = len(bars) - 1
    ma20, ma50, ma100, ma200, vma50 = sma(c, 20), sma(c, 50), sma(c, 100), sma(c, 200), sma(v, 50)
    gtgd20 = sum(c[i] * v[i] for i in range(L - 19, L + 1)) / 20 * 1000 / 1e9  # tỷ đồng
    vol5, vol5p = sum(v[L - 4:L + 1]), sum(v[L - 9:L - 4])
    hh20 = lambda i: max(b["h"] for b in bars[i - 20:i])

    buy, sell = [], []
    if within(L, lambda i: cross_up(ma20, ma50, i)):
        buy.append("MA20 cắt lên MA50")
    m3 = [ma20[L], ma50[L], ma100[L]]
    if None not in m3 and (max(m3) / min(m3) - 1) * 100 <= 2 and c[L] > max(m3):
        buy.append("MA20/50/100 hội tụ (≤2%), giá nằm trên")
    if vol5p > 0 and vol5 >= 2 * vol5p and c[L] >= c[L - 5]:
        buy.append(f"KL 5 phiên gấp {fmt(vol5 / vol5p, 1)} lần 5 phiên trước")
    if within(L, lambda i: vma50[i - 1] and c[i] > hh20(i) and v[i] >= 1.5 * vma50[i - 1] and ma50[i] and c[i] > ma50[i]):
        buy.append("Vượt đỉnh 20 phiên với KL ≥1,5 lần TB50")
    if within(L, lambda i: cross_up(ma50, ma200, i)):
        buy.append("Giao cắt vàng MA50 × MA200")

    if within(L, lambda i: cross_dn(ma20, ma50, i)):
        sell.append("MA20 cắt xuống MA50")
    if vol5p > 0 and vol5 >= 2 * vol5p and c[L] < c[L - 5]:
        sell.append(f"KL 5 phiên gấp {fmt(vol5 / vol5p, 1)} lần nhưng giá giảm")
    if within(L, lambda i: cross_dn(c, ma50, i) and vma50[i - 1] and v[i] >= 1.5 * vma50[i - 1]):
        sell.append("Gãy MA50 với KL lớn")
    if within(L, lambda i: cross_dn(ma50, ma200, i)):
        sell.append("Giao cắt tử thần MA50 × MA200")

    return dict(sym=sym, floor=floor, date=bars[L]["t"], close=c[L], chg=(c[L] / c[L - 1] - 1) * 100 if c[L - 1] else 0,
                chg5=(c[L] / c[L - 5] - 1) * 100 if c[L - 5] else 0, gtgd20=gtgd20, buy=buy, sell=sell,
                above50=ma50[L] is not None and c[L] > ma50[L], above200=ma200[L] is not None and c[L] > ma200[L])


def index_note(name, bars):
    if not bars or len(bars) < 51:
        return None
    c = [b["c"] for b in bars]
    L = len(c) - 1
    ma20, ma50 = sma(c, 20)[L], sma(c, 50)[L]
    trend = "trên" if c[L] > ma20 else "dưới"
    trend50 = "trên" if c[L] > ma50 else "dưới"
    return dict(name=name, close=c[L], chg=(c[L] / c[L - 1] - 1) * 100, chg5=(c[L] / c[L - 5] - 1) * 100,
                date=bars[L]["t"], note=f"{trend} MA20, {trend50} MA50")


def load_symbols():
    data = json.loads((ROOT / "web" / "symbols.json").read_text(encoding="utf-8"))["data"]
    return [(x["code"], x["floor"]) for x in data]


def fmt(x, d=2):
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(x):
    cls = "up" if x > 0 else "dn" if x < 0 else ""
    return f'<span class="{cls}">{"+" if x > 0 else ""}{fmt(x, 1)}%</span>'


def table(rows, key):
    if not rows:
        return "<p class='muted'>Không có mã nào.</p>"
    out = ["<table><tr><th>Mã</th><th>Sàn</th><th>Giá</th><th>Phiên</th><th>5 phiên</th><th>GTGD TB20</th><th>Tín hiệu</th></tr>"]
    for r in rows:
        out.append(f"<tr><td><b>{r['sym']}</b></td><td>{r['floor']}</td><td>{fmt(r['close'])}</td><td>{pct(r['chg'])}</td>"
                   f"<td>{pct(r['chg5'])}</td><td>{fmt(r['gtgd20'], 1)} tỷ</td><td>{html.escape('; '.join(r[key]))}</td></tr>")
    return "\n".join(out) + "</table>"


def render(results, notes, min_value, scanned, failed, started):
    day = lambda t: datetime.fromtimestamp(t, VN_TZ).strftime("%d/%m/%Y")
    session = max((r["date"] for r in results), default=None)
    liquid = [r for r in results if r["gtgd20"] >= min_value and r["date"] == session]
    buys = sorted([r for r in liquid if r["buy"] and not r["sell"]], key=lambda r: (-len(r["buy"]), -r["gtgd20"]))
    sells = sorted([r for r in liquid if r["sell"] and not r["buy"]], key=lambda r: (-len(r["sell"]), -r["gtgd20"]))
    mixed = [r for r in liquid if r["buy"] and r["sell"]]
    up = sum(r["chg"] > 0 for r in liquid)
    dn = sum(r["chg"] < 0 for r in liquid)
    a50 = sum(r["above50"] for r in liquid) * 100 / max(len(liquid), 1)
    a200 = sum(r["above200"] for r in liquid) * 100 / max(len(liquid), 1)
    top_val = sorted(liquid, key=lambda r: -r["gtgd20"])[:10]
    gainers = sorted(liquid, key=lambda r: -r["chg5"])[:5]
    losers = sorted(liquid, key=lambda r: r["chg5"])[:5]

    idx_rows = "".join(f"<tr><td><b>{n['name']}</b></td><td>{fmt(n['close'])}</td><td>{pct(n['chg'])}</td><td>{pct(n['chg5'])}</td>"
                       f"<td>{n['note']}</td></tr>" for n in notes)
    short = lambda rs: ", ".join(f"{r['sym']} ({pct(r['chg5'])})" for r in rs) or "không có"
    mixed_html = (f"<p class='muted'>Có cả tín hiệu mua lẫn bán (nên đứng ngoài): {', '.join(r['sym'] for r in mixed)}</p>"
                  if mixed else "")
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Bản tin CK {datetime.now(VN_TZ):%d/%m/%Y}</title>
<style>
body{{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:0;background:#f6f7f9;color:#1d2433}}
main{{max-width:1000px;margin:0 auto;padding:16px}} h1{{font-size:22px;margin:4px 0}} h2{{font-size:17px;margin:22px 0 8px}}
.card{{background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:12px 14px;margin:10px 0;overflow-x:auto}}
table{{border-collapse:collapse;width:100%}} th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid #eef0f4;white-space:nowrap}}
td:last-child{{white-space:normal}} th{{font-size:13px;color:#5b6475;font-weight:600}}
.up{{color:#0a8a43;font-weight:600}} .dn{{color:#d1342f;font-weight:600}} .muted{{color:#6b7385;font-size:13px}}
.buy h2{{color:#0a8a43}} .sell h2{{color:#d1342f}}
</style></head><body><main>
<h1>Bản tin cổ phiếu nổi bật</h1>
<p class="muted">Dữ liệu phiên {day(session) if session else "?"} · tạo lúc {started:%H:%M %d/%m/%Y} · quét {scanned} mã,
{len(liquid)} mã có GTGD TB20 ≥ {fmt(min_value, 0)} tỷ{f" · {failed} mã không lấy được dữ liệu" if failed else ""}</p>

<div class="card"><h2 style="margin-top:0">Thị trường</h2>
<table><tr><th>Chỉ số</th><th>Điểm</th><th>Phiên</th><th>5 phiên</th><th>Xu hướng</th></tr>{idx_rows}</table>
<p>Trong các mã thanh khoản: <span class="up">{up} tăng</span> / <span class="dn">{dn} giảm</span> phiên gần nhất ·
{fmt(a50, 0)}% mã trên MA50 · {fmt(a200, 0)}% mã trên MA200.</p>
<p>GTGD lớn nhất (TB20): {", ".join(f"{r['sym']} {fmt(r['gtgd20'], 0)} tỷ" for r in top_val)}</p>
<p>Tăng mạnh 5 phiên: {short(gainers)}<br>Giảm mạnh 5 phiên: {short(losers)}</p></div>

<div class="card buy"><h2>Tín hiệu MUA ({len(buys)} mã)</h2>{table(buys, "buy")}{mixed_html}</div>
<div class="card sell"><h2>Tín hiệu BÁN ({len(sells)} mã)</h2>{table(sells, "sell")}</div>

<p class="muted">Giá tính bằng nghìn đồng. Tín hiệu giao cắt tính trong {N_CROSS} phiên gần nhất. Nguồn giá: VNDirect.
Đây là bộ lọc kỹ thuật tự động, không phải khuyến nghị đầu tư.</p>
</main></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Bản tin cổ phiếu nổi bật buổi sáng")
    ap.add_argument("--gtgd", type=float, default=3, help="ngưỡng GTGD TB20 (tỷ đồng), mặc định 3")
    ap.add_argument("--khong-mo", action="store_true", help="không mở trình duyệt sau khi tạo")
    ap.add_argument("--luong", type=int, default=12, help="số luồng tải song song")
    args = ap.parse_args()

    started = datetime.now(VN_TZ)
    symbols = load_symbols()
    print(f"Đang quét {len(symbols)} mã...")
    with ThreadPoolExecutor(args.luong) as ex:
        bars = list(ex.map(lambda s: fetch(s[0]), symbols))
        idx_bars = list(ex.map(lambda x: fetch(x[0]), INDEXES))
    results = [r for (sym, floor), b in zip(symbols, bars) if (r := analyze(sym, floor, b))]
    failed = sum(b is None for b in bars)
    notes = [n for (_, name), b in zip(INDEXES, idx_bars) if (n := index_note(name, b))]
    if not results:
        print("Không lấy được dữ liệu (kiểm tra mạng). Không tạo bản tin.")
        return 1

    page = render(results, notes, args.gtgd, len(symbols), failed, started)
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"ban_tin_{started:%Y-%m-%d}.html"
    path.write_text(page, encoding="utf-8")
    (OUT_DIR / "moi_nhat.html").write_text(page, encoding="utf-8")
    print(f"Đã tạo {path} ({(datetime.now(VN_TZ) - started).seconds} giây)")
    if not args.khong_mo:
        webbrowser.open(path.resolve().as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
