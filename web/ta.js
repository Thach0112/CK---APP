// Chỉ báo kỹ thuật và quy tắc tín hiệu. Dùng chung cho dashboard (khớp số liệu với bản Python trong ckapp/).
const TA = {
  sma(a, n) { const o = Array(a.length).fill(NaN); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
  ewm(a, alpha, minP) { const o = Array(a.length).fill(NaN); let v = NaN, cnt = 0;
    for (let i = 0; i < a.length; i++) { if (isNaN(a[i])) continue; v = isNaN(v) ? a[i] : alpha * a[i] + (1 - alpha) * v;
      if (++cnt >= minP) o[i] = v; } return o; },
  ema(a, n) { return TA.ewm(a, 2 / (n + 1), n); },
  rsi(c, n = 14) { const g = [NaN], l = [NaN];
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g.push(Math.max(d, 0)); l.push(Math.max(-d, 0)); }
    const ag = TA.ewm(g, 1 / n, n), al = TA.ewm(l, 1 / n, n);
    return ag.map((x, i) => isNaN(x) ? NaN : al[i] === 0 ? 100 : 100 - 100 / (1 + x / al[i])); },
  macd(c, f = 12, s = 26, sg = 9) { const ef = TA.ema(c, f), es = TA.ema(c, s);
    const line = ef.map((x, i) => x - es[i]); const sig = TA.ewm(line, 2 / (sg + 1), sg);
    return { line, sig, hist: line.map((x, i) => x - sig[i]) }; },
  bollinger(c, n = 20, k = 2) { const mid = TA.sma(c, n);
    const sd = c.map((_, i) => { if (i < n - 1) return NaN; let t = 0; for (let j = i - n + 1; j <= i; j++) t += (c[j] - mid[i]) ** 2; return Math.sqrt(t / n); });
    return { mid, up: mid.map((m, i) => m + k * sd[i]), lo: mid.map((m, i) => m - k * sd[i]) }; },
  atr(bars, n = 14) { const tr = bars.map((b, i) => i === 0 ? b.high - b.low :
      Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)));
    return TA.ewm(tr, 1 / n, n); },
};

const crossUp = (a, b, i) => a[i] > b[i] && a[i - 1] <= b[i - 1];
const crossDn = (a, b, i) => a[i] < b[i] && a[i - 1] >= b[i - 1];

// Mỗi quy tắc: hàm chấm điểm (+1 mua, −1 bán, 0 trung tính) và mô tả trạng thái hiện tại.
const RULES = [
  { name: "MA20 cắt MA50", hint: "Giao cắt vàng / giao cắt tử thần ngắn hạn",
    f: (d, i) => crossUp(d.ma20, d.ma50, i) ? 1 : crossDn(d.ma20, d.ma50, i) ? -1 : 0,
    state: (d, i) => d.ma20[i] > d.ma50[i] ? "MA20 đang nằm trên MA50" : "MA20 đang nằm dưới MA50" },
  { name: "Xu hướng dài hạn (MA200)", hint: "Giá trên MA200 là xu hướng tăng",
    f: (d, i) => isNaN(d.ma200[i]) ? 0 : d.close[i] > d.ma200[i] ? 1 : -1,
    state: (d, i) => isNaN(d.ma200[i]) ? "Chưa đủ 200 phiên" : `Giá ${pct(d.close[i] / d.ma200[i] - 1)} so với MA200` },
  { name: "RSI quá bán / quá mua", hint: "RSI vượt lên 30 là mua, rơi xuống dưới 70 là bán",
    f: (d, i) => d.rsi[i] > 30 && d.rsi[i - 1] <= 30 ? 1 : d.rsi[i] < 70 && d.rsi[i - 1] >= 70 ? -1 : 0,
    state: (d, i) => `RSI ${d.rsi[i].toFixed(1)} · ${d.rsi[i] >= 70 ? "quá mua" : d.rsi[i] <= 30 ? "quá bán" : "trung tính"}` },
  { name: "MACD cắt Signal", hint: "Động lượng đảo chiều",
    f: (d, i) => crossUp(d.macd.line, d.macd.sig, i) ? 1 : crossDn(d.macd.line, d.macd.sig, i) ? -1 : 0,
    state: (d, i) => d.macd.hist[i] >= 0 ? "MACD trên Signal (động lượng tăng)" : "MACD dưới Signal (động lượng giảm)" },
  { name: "Dải Bollinger", hint: "Đóng cửa ngoài dải dưới/trên",
    f: (d, i) => d.close[i] < d.bb.lo[i] ? 1 : d.close[i] > d.bb.up[i] ? -1 : 0,
    state: (d, i) => `Vị trí trong dải: ${Math.round((d.close[i] - d.bb.lo[i]) / (d.bb.up[i] - d.bb.lo[i]) * 100)}%` },
  { name: "Khối lượng đột biến", hint: "KL > 1,5 lần TB20 cùng chiều giá",
    f: (d, i) => d.volRatio[i] > 1.5 ? Math.sign(d.close[i] - d.close[i - 1]) : 0,
    state: (d, i) => `KL bằng ${d.volRatio[i].toFixed(2)} lần trung bình 20 phiên` },
];

function pct(x, digits = 1) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(digits).replace(".", ",") + "%"; }

function analyze(bars) {
  const close = bars.map(b => b.close), vol = bars.map(b => b.volume), volMa = TA.sma(vol, 20);
  const d = { bars, close, ma20: TA.sma(close, 20), ma50: TA.sma(close, 50), ma100: TA.sma(close, 100), ma200: TA.sma(close, 200),
    rsi: TA.rsi(close), macd: TA.macd(close), bb: TA.bollinger(close), atr: TA.atr(bars), volMa,
    volRatio: vol.map((v, i) => v / volMa[i]) };
  d.score = []; d.action = []; d.hits = [];
  for (let i = 0; i < bars.length; i++) {
    let s = 0; const h = [];
    if (i > 0) RULES.forEach((r, k) => { const v = r.f(d, i) || 0; h.push(v); s += v; });
    d.score.push(s); d.hits.push(h); d.action.push(s >= 2 ? "MUA" : s <= -2 ? "BÁN" : "THEO DÕI");
  }
  return d;
}

// Tóm tắt phiên gần nhất cho bảng danh mục.
function summarize(sym, bars) {
  const d = analyze(bars), L = bars.length - 1, last = bars[L], prev = bars[L - 1] || last;
  const yr = bars.slice(-250);
  // Lần gần nhất có tín hiệu MUA/BÁN
  let lastSig = null;
  for (let i = L; i > 0 && L - i < 120; i--) if (d.action[i] !== "THEO DÕI") { lastSig = { i, act: d.action[i], date: bars[i].date, price: bars[i].close }; break; }
  return { sym, d, last, prev, chg: last.close - prev.close, chgPct: last.close / prev.close - 1,
    hi52: Math.max(...yr.map(b => b.high)), lo52: Math.min(...yr.map(b => b.low)),
    rsi: d.rsi[L], score: d.score[L], action: d.action[L], volRatio: d.volRatio[L], lastSig,
    trend: isNaN(d.ma200[L]) ? 0 : (last.close > d.ma50[L] && d.ma50[L] > d.ma200[L]) ? 1 : (last.close < d.ma50[L] && d.ma50[L] < d.ma200[L]) ? -1 : 0 };
}

if (typeof module !== "undefined") module.exports = { TA, RULES, analyze, summarize };
