// Dashboard theo dõi cổ phiếu. Dữ liệu lấy qua serve.py (/api/history → VNDirect).
const LWC = window.LightweightCharts;
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const DEFAULT_LIST = ["FPT", "VNM", "HPG", "VCB", "MWG", "SSI", "TCB", "MBB", "VHM", "GAS", "ACB", "VIC"];
const INDICES = [["VNINDEX", "VN-Index"], ["VN30", "VN30"], ["HNX", "HNX-Index"], ["UPCOM", "UPCoM"]];
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = { list: store.get("ck.watchlist", DEFAULT_LIST), sel: store.get("ck.selected", null),
  sort: store.get("ck.sort", "score"), range: 130, rows: {}, prevAction: {} };

// ---------- Dữ liệu ----------
async function fetchBars(sym, days = 900, timeout = 20_000) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);   // không để một mã treo làm đứng cả bộ quét
  let j;
  try { j = await (await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&days=${days}`, { signal: ac.signal })).json(); }
  catch (e) { throw new Error(e.name === "AbortError" ? "Quá thời gian chờ" : e.message); }
  finally { clearTimeout(tm); }
  if (j.s !== "ok" || !j.t?.length) throw new Error(j.error || "Không có dữ liệu cho mã này");
  return j.t.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10),
    open: +j.o[i], high: +j.h[i], low: +j.l[i], close: +j.c[i], volume: +j.v[i] }));
}
// Chỉ số cơ bản (FA) theo quý. Báo cáo tài chính chỉ đổi theo quý nên lưu lại 12 giờ.
const faSaved = store.get("ck.fa", {}), faMem = {};
let faSaveTimer = 0;
async function fetchFa(sym) {
  if (faMem[sym]) return faMem[sym];
  if (faSaved[sym] && Date.now() - faSaved[sym].t < 12 * 3600_000) return faMem[sym] = faSaved[sym].f;
  const j = await (await fetch(`/api/fundamental?symbol=${encodeURIComponent(sym)}`)).json();
  if (j.s !== "ok") throw new Error(j.error || "Không có dữ liệu cơ bản");
  const f = FA.normalize(j.source, j.data);
  if (!f.quarters.length) throw new Error("Không có dữ liệu cơ bản");
  f.quarters = f.quarters.slice(0, 8);
  faSaved[sym] = { t: Date.now(), f };
  clearTimeout(faSaveTimer); faSaveTimer = setTimeout(() => store.set("ck.fa", faSaved), 1000);   // gom lại rồi lưu một lần
  return faMem[sym] = f;
}
async function pool(items, n, fn) {   // giới hạn số request song song
  const out = []; let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) { const i = k++; out[i] = await fn(items[i]).catch(e => ({ error: e.message })); } }));
  return out;
}

// ---------- Định dạng ----------
const nf = (v, k = 2) => isFinite(v) ? v.toLocaleString("vi-VN", { minimumFractionDigits: k, maximumFractionDigits: k }) : "—";
const vol = v => !isFinite(v) ? "—" : v >= 1e6 ? nf(v / 1e6, 2) + " tr" : v >= 1e3 ? nf(v / 1e3, 0) + " N" : nf(v, 0);
const dir = x => x > 0 ? "up" : x < 0 ? "down" : "ref";
const sign = x => (x > 0 ? "+" : "") ;
const dmy = s => s.split("-").reverse().join("/");
const pill = (act, score) => `<span class="pill ${act}">${act}${score !== undefined ? `<span class="sc">${score > 0 ? "+" : ""}${score}</span>` : ""}</span>`;

function spark(values, w = 90, h = 26, color) {
  const v = values.filter(isFinite); if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), x = i => (i / (v.length - 1)) * (w - 2) + 1, y = p => h - 2 - (p - lo) / (hi - lo || 1) * (h - 4);
  const d = v.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join("");
  const c = color || css(v[v.length - 1] >= v[0] ? "--up" : "--down");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}L${x(v.length - 1)} ${h}L1 ${h}Z" fill="${c}" opacity=".12"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.4"/><circle cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="2" fill="${c}"/></svg>`;
}

// ---------- Giờ giao dịch (giờ Việt Nam) ----------
function vnNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { wd: p.weekday, m: +p.hour * 60 + +p.minute };
}
function marketOpen() {
  const { wd, m } = vnNow();
  if (wd === "Sat" || wd === "Sun") return false;
  return (m >= 9 * 60 && m <= 11 * 60 + 30) || (m >= 13 * 60 && m <= 15 * 60);
}

// ---------- Chỉ số ----------
async function loadIndices() {
  const res = await pool(INDICES, 4, ([s]) => fetchBars(s, 120));
  $("indices").innerHTML = INDICES.map(([s, name], i) => {
    const b = res[i];
    if (!Array.isArray(b) || b.length < 2) return `<div class="idx"><span class="n">${name}</span><span class="v">—</span><span class="c muted">Chưa có dữ liệu</span></div>`;
    const L = b.at(-1), P = b.at(-2), ch = L.close - P.close;
    return `<div class="idx"><span class="n">${name}</span><span class="v">${nf(L.close)}</span>
      <span class="c ${dir(ch)}">${sign(ch)}${nf(ch)} (${pct(ch / P.close, 2)})</span>${spark(b.slice(-60).map(x => x.close), 110, 40)}</div>`;
  }).join("");
}

// ---------- Danh mục ----------
async function loadWatchlist() {
  const res = await pool(state.list, 6, fetchBars);
  state.list.forEach((s, i) => {
    const b = res[i];
    if (Array.isArray(b) && b.length > 30) {
      const row = summarize(s, b);
      row.changed = state.prevAction[s] && state.prevAction[s] !== row.action;
      state.prevAction[s] = row.action; state.rows[s] = row;
    } else state.rows[s] = { sym: s, error: b?.error || "Không đủ dữ liệu" };
  });
}
function sortedRows() {
  const rows = state.list.map(s => state.rows[s]).filter(Boolean), ok = rows.filter(r => !r.error), bad = rows.filter(r => r.error);
  const key = { score: r => -r.score * 1000 - r.chgPct, chg: r => -r.chgPct, rsi: r => -r.rsi, vol: r => -r.volRatio, sym: r => r.sym }[state.sort];
  ok.sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  return ok.concat(bad);
}
function renderWatchlist() {
  const rows = sortedRows();
  const cnt = a => rows.filter(r => r.action === a).length;
  $("summary").innerHTML = rows.length ? `<span class="up">${cnt("MUA")} mua</span><span class="down">${cnt("BÁN")} bán</span><span>${cnt("THEO DÕI")} theo dõi</span>` : "";
  $("wl").innerHTML = rows.length ? rows.map(r => r.error
    ? `<tr data-s="${r.sym}"><td class="sym">${r.sym}<button class="x" data-del="${r.sym}" aria-label="Bỏ ${r.sym}">×</button></td><td colspan="5" class="err">${r.error}</td></tr>`
    : `<tr data-s="${r.sym}" class="${r.sym === state.sel ? "sel" : ""} ${r.changed ? "flash" : ""}">
        <td class="sym">${r.sym}<button class="x" data-del="${r.sym}" aria-label="Bỏ ${r.sym}">×</button></td>
        <td class="r num ${dir(r.chg)}">${nf(r.last.close)}</td>
        <td class="r num ${dir(r.chg)}">${pct(r.chgPct, 2)}</td>
        <td class="r num ${r.rsi >= 70 ? "down" : r.rsi <= 30 ? "up" : ""}">${nf(r.rsi, 0)}</td>
        <td>${spark(r.d.close.slice(-30), 64)}</td>
        <td>${pill(r.action, r.score)}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">Danh mục trống. Gõ một mã ở ô phía trên để bắt đầu theo dõi.</td></tr>`;
}

// ---------- Biểu đồ chi tiết ----------
let charts = null;
function makeCharts() {
  const base = { autoSize: true, layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--mono"), fontSize: 11 },
    grid: { vertLines: { color: css("--line") + "55" }, horzLines: { color: css("--line") + "55" } },
    rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line"), rightOffset: 4 },
    crosshair: { mode: LWC.CrosshairMode.Normal }, localization: { locale: "vi-VN", dateFormat: "dd/MM/yyyy" } };
  const main = LWC.createChart($("cMain"), base);
  const rsiC = LWC.createChart($("cRsi"), { ...base, timeScale: { ...base.timeScale, visible: false } });
  const macdC = LWC.createChart($("cMacd"), base);
  const line = (c, color, w = 1.5, extra = {}) => c.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
  const s = {
    candle: main.addCandlestickSeries({ upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down"), borderVisible: false }),
    vol: main.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }),
    ma20: line(main, css("--ma20")), ma50: line(main, css("--ma50")), ma200: line(main, css("--ma200"), 2),
    bbU: line(main, css("--bb"), 1, { lineStyle: 2 }), bbL: line(main, css("--bb"), 1, { lineStyle: 2 }),
    rsi: line(rsiC, css("--accent"), 1.5, { lastValueVisible: true }),
    hist: macdC.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }),
    macd: line(macdC, css("--accent")), sig: line(macdC, css("--ref")),
  };
  main.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  main.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
  s.rsi.createPriceLine({ price: 70, color: css("--down"), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  s.rsi.createPriceLine({ price: 30, color: css("--up"), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  const all = [main, rsiC, macdC]; let syncing = false;
  all.forEach(c => c.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true; all.forEach(o => o !== c && o.timeScale().setVisibleLogicalRange(r)); syncing = false; }));
  return { main, all, s };
}
const series = (d, arr) => d.bars.map((b, i) => isFinite(arr[i]) ? { time: b.date, value: arr[i] } : { time: b.date });

function renderDetail() {
  const r = state.rows[state.sel];
  if (!r || r.error) return;
  const d = r.d, L = d.bars.length - 1, last = r.last;
  $("dSym").textContent = r.sym;
  $("dSig").outerHTML = `<span id="dSig">${pill(r.action, r.score)}</span>`;
  $("dPrice").textContent = nf(last.close); $("dPrice").className = dir(r.chg);
  $("dChg").innerHTML = `<span class="${dir(r.chg)}">${sign(r.chg)}${nf(r.chg)} (${pct(r.chgPct, 2)})</span>`;
  $("dDate").textContent = `Phiên ${dmy(last.date)} · Mở ${nf(last.open)} · Cao ${nf(last.high)} · Thấp ${nf(last.low)}`;
  const st = [
    ["Khối lượng", vol(last.volume)], ["KL / TB20", nf(r.volRatio) + "×"],
    ["Cao 52 tuần", nf(r.hi52)], ["Thấp 52 tuần", nf(r.lo52)],
    ["So với MA200", isFinite(d.ma200[L]) ? pct(last.close / d.ma200[L] - 1) : "—"],
    ["Biên độ ATR(14)", pct(d.atr[L] / last.close)],
    ["Tín hiệu gần nhất", r.lastSig ? `${r.lastSig.act === "MUA" ? '<span class="up">MUA</span>' : '<span class="down">BÁN</span>'} ${dmy(r.lastSig.date).slice(0, 5)}` : "—"],
    ["Xu hướng", r.trend > 0 ? '<span class="up">Tăng</span>' : r.trend < 0 ? '<span class="down">Giảm</span>' : "Đi ngang"],
  ];
  $("dStats").innerHTML = st.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  renderFaDetail(r.sym, last.close);

  if (!charts) charts = makeCharts();
  const s = charts.s, up = css("--up"), down = css("--down");
  s.candle.setData(d.bars.map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
  s.vol.setData(d.bars.map((b, i) => ({ time: b.date, value: b.volume, color: (i && b.close < d.bars[i - 1].close ? down : up) + "55" })));
  const showMA = $("tMA").checked, showBB = $("tBB").checked;
  [["ma20", d.ma20], ["ma50", d.ma50], ["ma200", d.ma200]].forEach(([k, a]) => s[k].setData(showMA ? series(d, a) : []));
  s.bbU.setData(showBB ? series(d, d.bb.up) : []); s.bbL.setData(showBB ? series(d, d.bb.lo) : []);
  s.rsi.setData(series(d, d.rsi));
  s.hist.setData(d.bars.map((b, i) => isFinite(d.macd.hist[i]) ? { time: b.date, value: d.macd.hist[i], color: (d.macd.hist[i] >= 0 ? up : down) + "99" } : { time: b.date }));
  s.macd.setData(series(d, d.macd.line)); s.sig.setData(series(d, d.macd.sig));
  s.candle.setMarkers(window.btMarkers?.(r.sym, d) || ($("tSig").checked ? d.bars.flatMap((b, i) => i && d.action[i] === d.action[i - 1] ? [] : d.action[i] === "MUA"
    ? [{ time: b.date, position: "belowBar", color: up, shape: "arrowUp", text: "M" }]
    : d.action[i] === "BÁN" ? [{ time: b.date, position: "aboveBar", color: down, shape: "arrowDown", text: "B" }] : []) : []));
  applyRange();

  $("dRules").innerHTML = RULES.map((rule, k) => { const v = d.hits[L][k] || 0;
    return `<li><span class="v ${v > 0 ? "p" : v < 0 ? "n" : "z"}">${v > 0 ? "+1" : v < 0 ? "−1" : "0"}</span><b>${rule.name}</b><small>${rule.state(d, L)}</small></li>`; }).join("") +
    `<li><span class="v ${r.score > 0 ? "p" : r.score < 0 ? "n" : "z"}">${r.score > 0 ? "+" : ""}${r.score}</span><b>Tổng điểm → ${r.action}</b><small>Từ +2 trở lên là MUA, từ −2 trở xuống là BÁN</small></li>`;

  const ev = []; for (let i = L; i > 0 && ev.length < 10; i--) if (d.action[i] !== "THEO DÕI" && d.action[i] !== d.action[i - 1]) ev.push(i);
  $("dHist").innerHTML = ev.length ? ev.map(i => { const b = d.bars[i], ret = last.close / b.close - 1;
    return `<tr><td class="num">${dmy(b.date)}</td><td>${pill(d.action[i])}</td><td class="r num">${nf(b.close)}</td><td class="r num ${dir(ret)}">${pct(ret)}</td></tr>`; }).join("")
    : `<tr><td colspan="4" class="empty">Chưa có tín hiệu MUA/BÁN trong dữ liệu.</td></tr>`;
  window.btOnDetail?.(r.sym);
}
const fpct = (x, k = 1) => isFinite(x) && x !== null ? (x * 100).toFixed(k).replace(".", ",") + "%" : "—";   // tỷ lệ, không dấu +
const fnum = (x, k = 1) => isFinite(x) && x !== null ? nf(x, k) : "—";
async function renderFaDetail(sym, price) {
  if (!faMem[sym]) { $("dFaHead").textContent = "Chỉ số cơ bản (FA): đang tải…"; $("dFa").innerHTML = ""; }
  let m;
  try { m = FA.metrics(await fetchFa(sym), price); } catch (e) { m = null; $("dFaHead").textContent = "Chỉ số cơ bản (FA): " + e.message; }
  if (state.sel !== sym) return;
  if (!m) { $("dFa").innerHTML = ""; return; }
  $("dFaHead").textContent = `Chỉ số cơ bản (FA) · báo cáo ${m.period}`;
  const g = x => isFinite(x) && x !== null ? `<span class="${dir(x)}">${pct(x)}</span>` : "—";
  $("dFa").innerHTML = [["P/E", fnum(m.pe)], ["P/B", fnum(m.pb, 2)], ["EPS 4 quý (đ)", fnum(m.eps, 0)], ["PEG", fnum(m.peg, 2)],
    ["ROE", fpct(m.roe)], ["ROA", fpct(m.roa)], ["Nợ / vốn chủ", fnum(m.de, 2)], ["Biên LN ròng", fpct(m.nm)],
    ["Doanh thu quý so cùng kỳ", g(m.revYoY)], ["LNST quý so cùng kỳ", g(m.npYoY)], ["LNST 4 quý so cùng kỳ", g(m.npTtmYoY)], ["Cổ tức", fpct(m.dy)]]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
}
function applyRange() {
  if (!charts) return; const n = state.rows[state.sel]?.d.bars.length || 0;
  if (!state.range) charts.main.timeScale().fitContent();
  else charts.main.timeScale().setVisibleLogicalRange({ from: n - state.range, to: n + 3 });
}

// ---------- Điều khiển ----------
async function refresh() {
  $("refresh").disabled = true; $("updated").textContent = "Đang tải dữ liệu…";
  await Promise.all([loadIndices(), loadWatchlist()]);
  if (!state.rows[state.sel] || state.rows[state.sel].error) state.sel = sortedRows().find(r => !r.error)?.sym || null;
  renderWatchlist(); renderDetail();
  const open = marketOpen();
  $("mkt").textContent = open ? "Đang giao dịch" : "Ngoài giờ giao dịch"; $("mkt").className = "mkt" + (open ? " open" : "");
  $("updated").textContent = "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  $("refresh").disabled = false;
}
$("refresh").onclick = refresh;
$("sort").value = state.sort;
$("sort").onchange = e => { state.sort = e.target.value; store.set("ck.sort", state.sort); renderWatchlist(); };
$("wl").onclick = e => {
  const del = e.target.closest("[data-del]");
  if (del) { state.list = state.list.filter(s => s !== del.dataset.del); delete state.rows[del.dataset.del]; store.set("ck.watchlist", state.list); renderWatchlist(); return; }
  const tr = e.target.closest("tr[data-s]"); if (!tr || state.rows[tr.dataset.s]?.error) return;
  state.sel = tr.dataset.s; store.set("ck.selected", state.sel); renderWatchlist(); renderDetail();
};
$("addForm").onsubmit = async e => {
  e.preventDefault();
  const syms = $("addSym").value.toUpperCase().split(/[\s,;]+/).filter(s => /^[A-Z0-9]{2,10}$/.test(s) && !state.list.includes(s));
  if (!syms.length) return; $("addSym").value = "";
  state.list.push(...syms); store.set("ck.watchlist", state.list);
  const res = await pool(syms, 4, fetchBars);
  syms.forEach((s, i) => { const b = res[i]; state.rows[s] = Array.isArray(b) && b.length > 30 ? summarize(s, b) : { sym: s, error: b?.error || "Không đủ dữ liệu" }; });
  state.sel = syms.find(s => !state.rows[s].error) || state.sel; renderWatchlist(); renderDetail();
};
document.querySelectorAll(".ranges button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".ranges button").forEach(x => x.classList.toggle("on", x === b));
  state.range = +b.dataset.r; applyRange(); });
["tMA", "tBB", "tSig"].forEach(id => $(id).onchange = renderDetail);

function showTab(t) {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("tab-scan").hidden = t !== "scan"; $("tab-chart").hidden = t !== "chart"; $("tab-pf").hidden = t !== "pf";
  if (t === "chart") { renderWatchlist(); renderDetail(); }
  if (t === "pf") renderPortfolio();
  store.set("ck.tab", t);
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));

refresh();
setInterval(() => { if (marketOpen() && !document.hidden) refresh(); }, 60_000);
