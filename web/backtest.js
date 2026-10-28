// Kiểm định chiến lược (backtest): chạy lại các quy tắc mua/bán trên dữ liệu quá khứ của một mã
// để xem quy tắc nào chọn thời điểm mua/bán tốt nhất cho mã đó.
// Giả định gần với thực tế sàn VN: tín hiệu xuất hiện lúc đóng cửa, đặt lệnh theo giá mở cửa phiên sau,
// phí 0,15% mỗi chiều, thuế bán 0,1%, hàng mua về phải đến T+2 mới bán được.
const BT = typeof TA === "undefined" && typeof require === "function" ? require("./ta.js") : { TA, analyze };
const FEE = { buy: 0.0015, sell: 0.0015 + 0.001 };

// Các chuỗi chỉ báo riêng cho kiểm định, tính một lần cho mỗi bộ dữ liệu
function btPrep(d) {
  if (d.bt) return d.bt;
  const h = d.bars.map(b => b.high), l = d.bars.map(b => b.low);
  const roll = (a, n, f) => a.map((_, i) => i < n ? NaN : f(...a.slice(i - n, i)));   // n phiên TRƯỚC phiên i
  return d.bt = { hh20: roll(h, 20, Math.max), ll10: roll(l, 10, Math.min), rsi2: BT.TA.rsi(d.close, 2), ma5: BT.TA.sma(d.close, 5) };
}
const btUp = (a, b, i) => a[i] > b[i] && a[i - 1] <= b[i - 1];
const btDn = (a, b, i) => a[i] < b[i] && a[i - 1] >= b[i - 1];

// entry/exit: xét tại giá đóng cửa phiên i, trả về true nếu có tín hiệu
const STRATEGIES = [
  { id: "score", name: "Điểm tổng hợp của app", desc: "Mua khi tổng điểm 6 quy tắc ≥ +2, bán khi ≤ −2",
    entry: (d, i) => d.action[i] === "MUA", exit: (d, i) => d.action[i] === "BÁN" },
  { id: "ma", name: "MA20 cắt MA50", desc: "Mua khi MA20 cắt lên MA50, bán khi cắt xuống",
    entry: (d, i) => btUp(d.ma20, d.ma50, i), exit: (d, i) => btDn(d.ma20, d.ma50, i) },
  { id: "macd", name: "MACD cắt Signal", desc: "Mua khi MACD cắt lên Signal, bán khi cắt xuống",
    entry: (d, i) => btUp(d.macd.line, d.macd.sig, i), exit: (d, i) => btDn(d.macd.line, d.macd.sig, i) },
  { id: "macd200", name: "MACD theo xu hướng", desc: "Như MACD nhưng chỉ mua khi giá trên MA200; bán khi MACD cắt xuống hoặc giá thủng MA200",
    entry: (d, i) => d.close[i] > d.ma200[i] && btUp(d.macd.line, d.macd.sig, i),
    exit: (d, i) => btDn(d.macd.line, d.macd.sig, i) || d.close[i] < d.ma200[i] },
  { id: "rsi", name: "RSI 30 / 70", desc: "Mua khi RSI vượt lên 30, bán khi RSI rơi khỏi 70",
    entry: (d, i) => d.rsi[i] > 30 && d.rsi[i - 1] <= 30, exit: (d, i) => d.rsi[i] < 70 && d.rsi[i - 1] >= 70 },
  { id: "rsi2", name: "Mua điều chỉnh RSI(2)", desc: "Mua khi RSI(2) < 10 và giá trên MA200, bán khi giá đóng cửa trên MA5 (Connors)",
    entry: (d, i) => btPrep(d).rsi2[i] < 10 && d.close[i] > d.ma200[i], exit: (d, i) => d.close[i] > btPrep(d).ma5[i] },
  { id: "brk", name: "Vượt đỉnh 20 phiên", desc: "Mua khi giá vượt đỉnh 20 phiên trước, bán khi thủng đáy 10 phiên trước (Turtle)",
    entry: (d, i) => d.close[i] > btPrep(d).hh20[i], exit: (d, i) => d.close[i] < btPrep(d).ll10[i] },
];

// Chạy một chiến lược từ phiên `from` đến hết dữ liệu. stop: cắt lỗ theo tỷ lệ (0,07 = 7%), 0 là không dùng.
function backtest(d, strat, { from = 1, stop = 0 } = {}) {
  const b = d.bars, n = b.length, trades = [], equity = [];
  let eq = 1, pos = null, wantBuy = false, wantSell = null, inDays = 0;
  const close = (i, px, why) => {
    const gross = px / pos.px;
    eq = pos.cash * gross * (1 - FEE.sell);
    trades.push({ buy: pos.i, buyPx: pos.px, sell: i, sellPx: px, days: i - pos.i, why,
      ret: gross * (1 - FEE.buy) * (1 - FEE.sell) - 1 });
    pos = null; wantSell = null;
  };
  from = Math.max(1, from);
  for (let i = from; i < n; i++) {
    const canSell = pos && i >= pos.i + 2;   // T+2
    if (canSell && wantSell) close(i, b[i].open, wantSell);
    else if (!pos && wantBuy) pos = { i, px: b[i].open, cash: eq * (1 - FEE.buy) };
    wantBuy = false;
    if (pos && i >= pos.i + 2 && stop > 0) {
      const sp = pos.px * (1 - stop);
      if (b[i].low <= sp) close(i, Math.min(b[i].open, sp), "Cắt lỗ");
    }
    if (pos) inDays++;
    equity.push(pos ? pos.cash * b[i].close / pos.px : eq);
    if (pos) { if (!wantSell && strat.exit(d, i)) wantSell = "Tín hiệu bán"; }
    else if (strat.entry(d, i)) wantBuy = true;
  }
  const L = n - 1;
  let open = null;
  if (pos) {
    const gross = b[L].close / pos.px;
    open = { buy: pos.i, buyPx: pos.px, sell: null, sellPx: b[L].close, days: L - pos.i, why: wantSell ? "Chờ bán phiên tới" : "Đang nắm giữ",
      ret: gross * (1 - FEE.buy) * (1 - FEE.sell) - 1 };
    eq = pos.cash * gross * (1 - FEE.sell);
  }
  let peak = -Infinity, mdd = 0;
  for (const v of equity) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const wins = trades.filter(t => t.ret > 0).length;
  const hold = (b[L].close / b[from].open) * (1 - FEE.buy) * (1 - FEE.sell) - 1;
  return {
    strat, from, trades, open, equity, ret: eq - 1, hold, mdd,
    winRate: trades.length ? wins / trades.length : NaN,
    avg: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : NaN,
    avgDays: trades.length ? trades.reduce((a, t) => a + t.days, 0) / trades.length : NaN,
    exposure: inDays / (n - from),
    // Việc cần làm ở phiên tới theo chiến lược này
    next: pos ? (wantSell ? "BÁN" : "GIỮ") : (wantBuy ? "MUA" : "ĐỨNG NGOÀI"),
  };
}

// Kiểm định mọi chiến lược trong `years` năm gần nhất. Chiến lược tốt nhất: lãi cao nhất trong số có ≥ 3 lệnh.
function backtestAll(bars, { years = 3, stop = 0 } = {}) {
  const d = BT.analyze(bars), last = new Date(bars[bars.length - 1].date);
  const start = new Date(last); start.setFullYear(start.getFullYear() - years);
  const iso = start.toISOString().slice(0, 10);
  let from = bars.findIndex(b => b.date >= iso); if (from < 1) from = 1;
  const res = STRATEGIES.map(s => backtest(d, s, { from, stop })).sort((a, b) => b.ret - a.ret);
  const best = res.find(r => r.trades.length + (r.open ? 1 : 0) >= 3) || res[0];
  return { d, from, res, best, short: from === 1 };
}

if (typeof module !== "undefined") module.exports = { STRATEGIES, FEE, backtest, backtestAll };

// ---------- Giao diện ----------
if (typeof document !== "undefined") {
  const bt = { cache: {}, years: store.get("ck.btYears", 3), stop: store.get("ck.btStop", 7), pick: null, sym: null, out: null, chart: null };
  const BT_DAYS = 2400;   // ~6,5 năm: đủ 5 năm kiểm định + 200 phiên cho MA200

  async function btBars(sym) {
    const c = bt.cache[sym]; if (c && Date.now() - c.t < 10 * 60_000) return c.bars;
    const bars = await fetchBars(sym, BT_DAYS); bt.cache[sym] = { t: Date.now(), bars }; return bars;
  }
  const NEXT = { MUA: ["up", "MUA ở phiên tới"], BÁN: ["down", "BÁN ở phiên tới"], GIỮ: ["", "đang nắm giữ"], "ĐỨNG NGOÀI": ["muted", "đứng ngoài, chờ tín hiệu"] };

  window.renderBacktest = async function (sym) {
    if (!sym) return;
    const changed = sym !== bt.sym; bt.sym = sym;
    $("btYears").querySelectorAll("button").forEach(x => x.classList.toggle("on", +x.dataset.y === bt.years));
    $("btStop").value = bt.stop;
    if (changed) { bt.pick = null; bt.out = null; $("btVerdict").textContent = "Đang tải dữ liệu nhiều năm để kiểm định…"; $("btBody").innerHTML = ""; $("btTrades").innerHTML = ""; }
    let bars;
    try { bars = await btBars(sym); } catch (e) { if (bt.sym === sym) $("btVerdict").textContent = "Không tải được dữ liệu: " + e.message; return; }
    if (bt.sym !== sym) return;
    if (bars.length < 260) { $("btVerdict").textContent = "Mã này chưa đủ một năm dữ liệu để kiểm định."; return; }
    bt.out = backtestAll(bars, { years: bt.years, stop: bt.stop / 100 });
    const o = bt.out, B = o.best, nx = NEXT[B.next];
    if (!bt.pick || !o.res.some(r => r.strat.id === bt.pick)) bt.pick = B.strat.id;
    const span = `${dmy(bars[o.from].date)} – ${dmy(bars.at(-1).date)}`;
    $("btVerdict").innerHTML = `Từ ${span}${o.short ? " (mã chưa đủ " + bt.years + " năm dữ liệu)" : ""}, chiến lược hợp nhất với <b>${sym}</b> là ` +
      `<b>${B.strat.name}</b>: <b class="${dir(B.ret)}">${pct(B.ret)}</b> so với mua và giữ <b class="${dir(B.hold)}">${pct(B.hold)}</b>, ` +
      `thắng ${isFinite(B.winRate) ? Math.round(B.winRate * 100) + "%" : "—"} số lệnh. ` +
      `Theo chiến lược này hiện tại: <b class="${nx[0]}">${nx[1]}</b>.` +
      (B.ret < B.hold ? ` <span class="muted">Lưu ý: giai đoạn này mua và giữ còn lãi hơn mọi chiến lược canh thời điểm.</span>` : "");
    $("btBody").innerHTML = o.res.map(r => `
      <tr data-st="${r.strat.id}" class="${r.strat.id === bt.pick ? "sel" : ""}">
        <td><b>${r.strat.name}</b>${r === B ? ' <span class="pill MUA">Tốt nhất</span>' : ""}<br><small class="muted">${r.strat.desc}</small></td>
        <td class="r num ${dir(r.ret)}">${pct(r.ret)}</td>
        <td class="r num ${dir(r.ret - r.hold)}">${pct(r.ret - r.hold)}</td>
        <td class="r num">${r.trades.length}${r.open ? "+1" : ""}</td>
        <td class="r num">${isFinite(r.winRate) ? Math.round(r.winRate * 100) + "%" : "—"}</td>
        <td class="r num ${dir(r.avg)}">${isFinite(r.avg) ? pct(r.avg) : "—"}</td>
        <td class="r num down">${pct(r.mdd)}</td>
        <td class="r num">${Math.round(r.exposure * 100)}%</td>
        <td><span class="${NEXT[r.next][0]}">${r.next}</span></td></tr>`).join("");
    renderPick();
  };

  function renderPick() {
    const o = bt.out; if (!o) return;
    const r = o.res.find(x => x.strat.id === bt.pick), b = o.d.bars;
    $("btName").textContent = r.strat.name;
    const rows = (r.open ? [r.open] : []).concat([...r.trades].reverse());
    $("btTrades").innerHTML = rows.length ? rows.map(t => `<tr>
        <td class="num">${dmy(b[t.buy].date)}</td><td class="r num">${nf(t.buyPx)}</td>
        <td class="num">${t.sell === null ? "—" : dmy(b[t.sell].date)}</td><td class="r num">${nf(t.sellPx)}</td>
        <td class="r num">${t.days}</td><td class="r num ${dir(t.ret)}">${pct(t.ret)}</td><td class="muted">${t.why}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">Chiến lược này không có lệnh nào trong giai đoạn đã chọn.</td></tr>`;
    // Đường vốn: chiến lược so với mua và giữ (bắt đầu = 100)
    if (!bt.chart) {
      const base = { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--mono"), fontSize: 11 },
        grid: { vertLines: { visible: false }, horzLines: { color: css("--line") + "55" } }, rightPriceScale: { borderColor: css("--line") },
        timeScale: { borderColor: css("--line"), fixLeftEdge: true, fixRightEdge: true }, localization: { locale: "vi-VN", dateFormat: "dd/MM/yyyy" }, handleScroll: false, handleScale: false };
      const c = LightweightCharts.createChart($("cEq"), base), opt = { lineWidth: 2, priceLineVisible: false };
      bt.chart = { c, hold: c.addLineSeries({ ...opt, color: css("--muted"), lineWidth: 1 }), strat: c.addLineSeries({ ...opt, color: css("--accent") }) };
    }
    const p0 = b[o.from].open;
    bt.chart.hold.setData(b.slice(o.from).map(x => ({ time: x.date, value: x.close / p0 * 100 })));
    bt.chart.strat.setData(r.equity.map((v, k) => ({ time: b[o.from + k].date, value: v * 100 })));
    bt.chart.c.timeScale().fitContent();
    if ($("tBt").checked) renderDetail();
  }

  // Mũi tên mua/bán của chiến lược đang chọn, để vẽ lên biểu đồ giá (app.js gọi)
  window.btMarkers = function (sym, d) {
    if (!$("tBt").checked || bt.sym !== sym || !bt.out) return null;
    const r = bt.out.res.find(x => x.strat.id === bt.pick), b = bt.out.d.bars, have = new Set(d.bars.map(x => x.date)), m = [];
    for (const t of r.trades.concat(r.open ? [r.open] : [])) {
      m.push({ time: b[t.buy].date, position: "belowBar", color: css("--up"), shape: "arrowUp", text: "Mua" });
      if (t.sell !== null) m.push({ time: b[t.sell].date, position: "aboveBar", color: css("--down"), shape: "arrowDown", text: t.why === "Cắt lỗ" ? "Cắt lỗ" : "Bán" });
    }
    return m.filter(x => have.has(x.time)).sort((a, c) => a.time < c.time ? -1 : a.time > c.time ? 1 : 0);
  };

  $("btYears").onclick = e => { const x = e.target.closest("[data-y]"); if (!x) return; bt.years = +x.dataset.y; store.set("ck.btYears", bt.years); renderBacktest(bt.sym); };
  $("btStop").onchange = () => { bt.stop = Math.max(0, +$("btStop").value || 0); store.set("ck.btStop", bt.stop); renderBacktest(bt.sym); };
  $("btBody").onclick = e => { const tr = e.target.closest("tr[data-st]"); if (!tr) return; bt.pick = tr.dataset.st;
    $("btBody").querySelectorAll("tr").forEach(x => x.classList.toggle("sel", x === tr)); renderPick(); };
  // Mũi tên tín hiệu điểm và mũi tên lệnh kiểm định: chỉ hiện một loại để biểu đồ không rối
  $("tBt").onchange = () => { if ($("tBt").checked) $("tSig").checked = false; renderDetail(); };
  $("tSig").onchange = () => { if ($("tSig").checked) $("tBt").checked = false; renderDetail(); };
  // app.js gọi mỗi lần vẽ lại chi tiết; chỉ kiểm định lại khi đổi mã
  window.btOnDetail = sym => { if (sym !== bt.sym) renderBacktest(sym); };
}
