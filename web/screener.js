// Bộ lọc tín hiệu: quét nhiều mã theo các tiêu chí TA, báo mã nào cho tín hiệu MUA / BÁN.
const UNIVERSES = {
  vn30: { name: "VN30", list: "ACB BCM BID BVH CTG FPT GAS GVR HDB HPG LPB MBB MSN MWG PLX SAB SHB SSB SSI STB TCB TPB VCB VHM VIB VIC VJC VNM VPB VRE" },
  liquid: { name: "Thanh khoản cao (~100 mã)", list: "ACB BCM BID BVH CTG FPT GAS GVR HDB HPG LPB MBB MSN MWG PLX SAB SHB SSB SSI STB TCB TPB VCB VHM VIB VIC VJC VNM VPB VRE " +
    "DGC DIG DXG EIB EVF FRT GEX GMD HAG HCM HDG KBC KDH NLG NVL PC1 PDR PNJ POW REE SBT SCS SZC VCI VND VHC VIX VSC DCM DPM KDC NKG HSG CTD CII DBC ANV BMP PVD PVT PHR " +
    "OCB MSB NAB CTR VGC VPI HHV LCG FCN TCH DXS KOS VTP HAH SIP IDI TNH DGW PET " +
    "SHS PVS CEO IDC MBS TNG HUT " + "ACV VEA BSR OIL MCH QNS" },
  mine: { name: "Danh sách theo dõi" },
  pf: { name: "Danh mục của tôi" },
};

// Mỗi tiêu chí: side (MUA/BÁN), tham số chỉnh được, hàm kiểm tra tại phiên cuối L với cửa sổ N phiên.
const within = (N, L, f) => { for (let i = L; i > L - N && i > 0; i--) if (f(i)) return true; return false; };
const CRITERIA = [
  { id: "ma2up", side: "MUA", label: "MA20 cắt lên MA50", test: (d, L, N) => within(N, L, i => crossUp(d.ma20, d.ma50, i)) },
  { id: "ma3up", side: "MUA", label: "MA20, MA50, MA100 giao nhau, xếp thành xu hướng tăng (MA20 > MA50 > MA100)",
    test: (d, L, N) => d.ma20[L] > d.ma50[L] && d.ma50[L] > d.ma100[L] &&
      within(N, L, i => !(d.ma20[i - 1] > d.ma50[i - 1] && d.ma50[i - 1] > d.ma100[i - 1])) },
  { id: "ma3conv", side: "MUA", label: "MA20, MA50, MA100 hội tụ: chênh lệch không quá", param: { key: "conv", val: 2, unit: "%" },
    test: (d, L, N, p) => { const m = [d.ma20[L], d.ma50[L], d.ma100[L]]; return m.every(isFinite) && (Math.max(...m) / Math.min(...m) - 1) * 100 <= p.conv && d.close[L] > Math.max(...m); },
    note: "và giá đóng cửa nằm trên cả 3 đường" },
  { id: "vol5", side: "MUA", label: "KL 5 phiên gần nhất gấp", param: { key: "volK", val: 2, unit: "lần 5 phiên trước" },
    test: (d, L, N, p) => { const v = d.bars.map(b => b.volume), a = sum(v, L - 4, L), b = sum(v, L - 9, L - 5); return b > 0 && a >= p.volK * b && d.close[L] >= d.close[L - 5]; },
    note: "và giá không giảm trong 5 phiên đó" },
  { id: "macdup", side: "MUA", label: "MACD cắt lên đường Signal", test: (d, L, N) => within(N, L, i => crossUp(d.macd.line, d.macd.sig, i)) },
  { id: "rsiup", side: "MUA", label: "RSI vượt lên khỏi vùng quá bán (30)", test: (d, L, N) => within(N, L, i => d.rsi[i] > 30 && d.rsi[i - 1] <= 30) },
  { id: "brk20", side: "MUA", label: "Giá vượt đỉnh 20 phiên trước", test: (d, L, N) => within(N, L, i => d.close[i] > Math.max(...d.bars.slice(i - 20, i).map(b => b.high))) },
  { id: "ma200", side: "MUA", label: "Giá đang nằm trên MA200 (xu hướng dài hạn tăng)", test: (d, L) => d.close[L] > d.ma200[L] },

  // --- Bộ lọc dựa trên nghiên cứu (xem tài liệu "Bộ lọc TA cho cổ phiếu Việt Nam") ---
  { id: "trend", side: "MUA", label: "Xu hướng mạnh (Trend Template – Minervini)", group: "pro",
    note: "giá > MA50 > MA150 > MA200, MA200 đi lên 1 tháng, cao hơn đáy 52 tuần ≥30%, cách đỉnh 52 tuần ≤25%",
    test: (d, L) => { const x = ext(d), c = d.close[L];
      return c > d.ma50[L] && d.ma50[L] > x.ma150[L] && x.ma150[L] > d.ma200[L] && d.ma200[L] > d.ma200[L - 20] &&
        c >= 1.3 * x.lo52[L] && c >= 0.75 * x.hi52[L]; } },
  { id: "brkvol", side: "MUA", label: "Breakout có khối lượng (O'Neil): vượt đỉnh 20 phiên, KL ≥", param: { key: "brkK", val: 1.5, unit: "lần TB50" }, group: "pro",
    note: "và giá trên MA50",
    test: (d, L, N, p) => { const x = ext(d); return within(N, L, i => d.close[i] > x.hh20[i - 1] && d.bars[i].volume >= p.brkK * x.vma50[i - 1] && d.close[i] > d.ma50[i]); } },
  { id: "near52", side: "MUA", label: "Gần đỉnh 52 tuần: cách đỉnh không quá", param: { key: "near", val: 5, unit: "%" }, group: "pro",
    note: "và MA50 trên MA200 (George & Hwang)",
    test: (d, L, N, p) => { const x = ext(d); return d.close[L] >= (1 - p.near / 100) * x.hi52[L] && d.ma50[L] > d.ma200[L]; } },
  { id: "rsi2", side: "MUA", label: "Mua điều chỉnh trong xu hướng tăng: RSI(2) dưới", param: { key: "rsi2", val: 10, unit: "" }, group: "pro",
    note: "và giá trên MA200 (Connors). Thoát khi giá đóng cửa trên MA5",
    test: (d, L, N, p) => { const x = ext(d); return within(N, L, i => x.rsi2[i] < p.rsi2 && d.close[i] > d.ma200[i]); } },
  { id: "squeeze", side: "MUA", label: "Nén Bollinger rồi bứt phá lên trên dải trên", group: "pro",
    note: "độ rộng dải thấp nhất 120 phiên trong 10 phiên gần đây",
    test: (d, L, N) => { const x = ext(d); return within(N, L, i => d.close[i] > d.bb.up[i] && Math.min(...x.bw.slice(i - 10, i)) <= x.bwLo[i - 1] * 1.0001); } },
  { id: "golden", side: "MUA", label: "Giao cắt vàng: MA50 cắt lên MA200", group: "pro", test: (d, L, N) => within(N, L, i => crossUp(d.ma50, d.ma200, i)) },

  // --- Dòng tiền gom hàng (tích luỹ) ---
  { id: "accum", side: "MUA", label: "Gom hàng âm thầm: giá đi ngang (biên độ 30 phiên ≤", param: { key: "rng", val: 15, unit: "%) nhưng OBV lên đỉnh 30 phiên" }, group: "flow",
    note: "và Chaikin Money Flow (20) dương",
    test: (d, L, N, p) => { const x = ext(d), hi = Math.max(...x.h.slice(L - 29, L + 1)), lo = Math.min(...x.l.slice(L - 29, L + 1));
      return (hi / lo - 1) * 100 <= p.rng && within(N, L, i => x.obv[i] >= Math.max(...x.obv.slice(i - 29, i + 1))) && x.cmf[L] > 0; } },
  { id: "cmf", side: "MUA", label: "Chaikin Money Flow (20) lớn hơn", param: { key: "cmfMin", val: 0.1, unit: "" }, group: "flow",
    note: "tiền vào chiếm ưu thế: giá thường đóng cửa gần mức cao trong phiên với KL lớn",
    test: (d, L, N, p) => ext(d).cmf[L] > p.cmfMin },
  { id: "updown", side: "MUA", label: "KL phiên tăng / KL phiên giảm (50 phiên) ≥", param: { key: "udr", val: 1.3, unit: "lần" }, group: "flow",
    note: "kiểu chỉ số Accumulation/Distribution của IBD",
    test: (d, L, N, p) => { let up = 0, dn = 0; for (let i = L - 49; i <= L; i++) { if (d.close[i] > d.close[i - 1]) up += d.bars[i].volume; else if (d.close[i] < d.close[i - 1]) dn += d.bars[i].volume; } return dn > 0 && up / dn >= p.udr; } },
  { id: "pocket", side: "MUA", label: "Pocket pivot: phiên tăng có KL lớn hơn mọi phiên giảm trong 10 phiên trước", group: "flow",
    note: "và giá trên MA50 (Morales & Kacher)",
    test: (d, L, N) => within(N, L, i => { if (!(d.close[i] > d.close[i - 1] && d.close[i] > d.ma50[i])) return false;
      let mx = 0; for (let j = i - 10; j < i; j++) if (d.close[j] < d.close[j - 1]) mx = Math.max(mx, d.bars[j].volume); return d.bars[i].volume > mx; }) },
  { id: "distrib", side: "BÁN", label: "Phân phối: từ 4 phiên giảm ≥1% với KL ≥ 1,2 lần TB50 trong 20 phiên", group: "flow",
    note: "dấu hiệu tổ chức xả hàng (đếm phiên phân phối kiểu O'Neil)",
    test: (d, L) => { const x = ext(d); let n = 0; for (let i = L - 19; i <= L; i++) if (d.close[i] <= d.close[i - 1] * 0.99 && d.bars[i].volume >= 1.2 * x.vma50[i - 1]) n++; return n >= 4; } },

  { id: "ma2dn", side: "BÁN", label: "MA20 cắt xuống MA50", test: (d, L, N) => within(N, L, i => crossDn(d.ma20, d.ma50, i)) },
  { id: "ma3dn", side: "BÁN", label: "MA20, MA50, MA100 xếp thành xu hướng giảm (MA20 < MA50 < MA100)",
    test: (d, L, N) => d.ma20[L] < d.ma50[L] && d.ma50[L] < d.ma100[L] &&
      within(N, L, i => !(d.ma20[i - 1] < d.ma50[i - 1] && d.ma50[i - 1] < d.ma100[i - 1])) },
  { id: "macddn", side: "BÁN", label: "MACD cắt xuống đường Signal", test: (d, L, N) => within(N, L, i => crossDn(d.macd.line, d.macd.sig, i)) },
  { id: "rsidn", side: "BÁN", label: "RSI rơi khỏi vùng quá mua (70)", test: (d, L, N) => within(N, L, i => d.rsi[i] < 70 && d.rsi[i - 1] >= 70) },
  { id: "vol5dn", side: "BÁN", label: "KL 5 phiên gần nhất gấp đôi 5 phiên trước khi giá giảm",
    test: (d, L) => { const v = d.bars.map(b => b.volume); return sum(v, L - 4, L) >= 2 * sum(v, L - 9, L - 5) && d.close[L] < d.close[L - 5]; } },
  { id: "brkdn", side: "BÁN", label: "Giá thủng đáy 20 phiên trước", test: (d, L, N) => within(N, L, i => d.close[i] < Math.min(...d.bars.slice(i - 20, i).map(b => b.low))) },
  { id: "ma50vol", side: "BÁN", label: "Gãy MA50 với khối lượng lớn (O'Neil): KL ≥ 1,5 lần TB50", group: "pro",
    test: (d, L, N) => { const x = ext(d); return within(N, L, i => crossDn(d.close, d.ma50, i) && d.bars[i].volume >= 1.5 * x.vma50[i - 1]); } },
  { id: "death", side: "BÁN", label: "Giao cắt tử thần: MA50 cắt xuống MA200", group: "pro", test: (d, L, N) => within(N, L, i => crossDn(d.ma50, d.ma200, i)) },
  { id: "rsi2exit", side: "BÁN", label: "Chốt lệnh RSI(2): giá đóng cửa vượt lên MA5", group: "pro", test: (d, L, N) => { const x = ext(d); return within(N, L, i => crossUp(d.close, x.ma5, i)); } },
  { id: "mal200", side: "BÁN", label: "Giá cắt xuống dưới MA200", test: (d, L, N) => within(N, L, i => crossDn(d.close, d.ma200, i)) },
];
// Các chuỗi chỉ báo bổ sung, tính một lần cho mỗi mã
function ext(d) {
  if (d.x) return d.x;
  const c = d.close, h = d.bars.map(b => b.high), l = d.bars.map(b => b.low), v = d.bars.map(b => b.volume);
  const roll = (a, n, f) => a.map((_, i) => i < n - 1 ? NaN : f(a.slice(i - n + 1, i + 1)));
  let o = 0; const obv = c.map((x, i) => (o += i === 0 ? 0 : x > c[i - 1] ? v[i] : x < c[i - 1] ? -v[i] : 0));
  const mfv = d.bars.map(b => b.high === b.low ? 0 : ((b.close - b.low) - (b.high - b.close)) / (b.high - b.low) * b.volume);
  const cmf = c.map((_, i) => i < 19 ? NaN : sum(mfv, i - 19, i) / sum(v, i - 19, i));
  const bw = d.bb.up.map((u, i) => (u - d.bb.lo[i]) / d.bb.mid[i]);
  return d.x = { h, l, obv, cmf, ma5: TA.sma(c, 5), ma150: TA.sma(c, 150), vma50: TA.sma(v, 50), rsi2: TA.rsi(c, 2),
    hh20: roll(h, 20, a => Math.max(...a)), hi52: roll(h, Math.min(250, h.length), a => Math.max(...a)), lo52: roll(l, Math.min(250, l.length), a => Math.min(...a)),
    bw, bwLo: roll(bw, 120, a => Math.min(...a)) };
}
// Giá trị giao dịch trung bình 20 phiên, đơn vị tỷ đồng (giá tính bằng nghìn đồng)
function avgValue(bars) { const t = bars.slice(-20); return t.reduce((a, b) => a + b.close * b.volume, 0) / t.length * 1000 / 1e9; }
function sum(a, from, to) { let s = 0; for (let i = Math.max(0, from); i <= to; i++) s += a[i]; return s; }

const PRESETS = [
  { name: "Khuyến nghị: Xu hướng mạnh + Breakout", on: ["trend", "brkvol"], mode: "all", n: 5 },
  { name: "Xu hướng mạnh (Minervini)", on: ["trend"], mode: "all", n: 3 },
  { name: "Gần đỉnh 52 tuần", on: ["near52"], mode: "all", n: 1 },
  { name: "Mua điều chỉnh RSI(2)", on: ["rsi2"], mode: "all", n: 1 },
  { name: "Nén Bollinger bứt phá", on: ["squeeze"], mode: "all", n: 3 },
  { name: "Giao cắt vàng MA50/200", on: ["golden"], mode: "all", n: 5 },
  { name: "Dòng tiền gom hàng", on: ["accum", "pocket"], mode: "any", n: 3 },
  { name: "Bộ lọc của bạn: MA20/50/100 + KL", on: ["ma2up", "ma3up", "vol5"], mode: "any", n: 3 },
  { name: "Cảnh báo BÁN", on: ["ma50vol", "death", "mal200", "brkdn", "distrib"], mode: "any", n: 3, sell: true },
];
const scr = store.get("ck.screener", { uni: "vn30", custom: "", n: 3, mode: "any",
  on: ["ma2up", "ma3up", "vol5", "ma2dn", "ma3dn"], params: {} });
for (const c of CRITERIA) if (c.param && scr.params[c.param.key] === undefined) scr.params[c.param.key] = c.param.val;
const cache = {};   // bars theo mã, giữ trong 60 giây
async function barsCached(sym) {
  const c = cache[sym]; if (c && Date.now() - c.t < 60_000) return c.bars;
  const bars = await fetchBars(sym, 400); cache[sym] = { t: Date.now(), bars }; return bars;
}

function renderCriteria() {
  const GROUPS = [["pro", "Theo nghiên cứu"], ["flow", "Dòng tiền"], [undefined, "Cơ bản"]];
  const box = side => GROUPS.map(([g, title]) => { const items = CRITERIA.filter(c => c.side === side && c.group === g);
    return items.length ? `<div class="cgroup">${title}</div>` + item(items) : ""; }).join("");
  const item = list => list.map(c => `
    <label class="crit"><input type="checkbox" data-c="${c.id}" ${scr.on.includes(c.id) ? "checked" : ""}>
      <span>${c.label}${c.param ? ` <input class="pnum" type="number" step="any" min="0" data-p="${c.param.key}" value="${scr.params[c.param.key] ?? c.param.val}" aria-label="${c.label}"> ${c.param.unit}` : ""}${c.note ? ` <small>${c.note}</small>` : ""}</span></label>`).join("");
  $("presets").innerHTML = PRESETS.map((p, k) => `<button type="button" class="preset ${p.sell ? "sell" : ""} ${k === 0 ? "rec" : ""}" data-pre="${k}">${p.name}</button>`).join("");
  $("critBuy").innerHTML = box("MUA"); $("critSell").innerHTML = box("BÁN");
  $("uni").value = scr.uni; $("custom").value = scr.custom; $("custom").hidden = scr.uni !== "custom";
  $("minVal").value = scr.minVal ?? 1;
  $("winN").value = scr.n; $("mode").value = scr.mode;
}
function readForm() {
  scr.on = [...document.querySelectorAll("[data-c]:checked")].map(x => x.dataset.c);
  document.querySelectorAll("[data-p]").forEach(x => scr.params[x.dataset.p] = +x.value);
  scr.minVal = Math.max(0, +String($("minVal").value).replace(",", ".") || 0);
  scr.uni = $("uni").value; scr.custom = $("custom").value; scr.n = Math.max(1, +$("winN").value || 3); scr.mode = $("mode").value;
  $("custom").hidden = scr.uni !== "custom"; store.set("ck.screener", scr);
}
const MARKETS = { all: ["HOSE", "HNX", "UPCOM"], hose: ["HOSE"], hnx: ["HNX"], upcom: ["UPCOM"] };
async function marketSymbols(floors) {
  let list = store.get("ck.symbols", null);
  if (!list || Date.now() - list.t > 86400_000) {
    // Danh sách mã lưu sẵn (web/symbols.json, lấy từ SSI iBoard); không có thì hỏi server
    let j = null;
    try { j = await (await fetch("symbols.json", { cache: "no-store" })).json(); } catch {}
    if (j?.s !== "ok") { try { j = await (await fetch("/api/symbols")).json(); } catch { j = { s: "error", error: "không có nguồn danh sách mã" }; } }
    if (j.s !== "ok") throw new Error(j.error || "lỗi không rõ");
    list = { t: Date.now(), data: j.data }; store.set("ck.symbols", list);
  }
  return list.data.filter(x => floors.includes(x.floor)).map(x => x.code);
}
async function universe() {
  if (MARKETS[scr.uni]) return marketSymbols(MARKETS[scr.uni]);
  const raw = scr.uni === "pf" ? store.get("ck.portfolio", { items: [] }).items.map(x => x.sym).join(" ") : scr.uni === "mine" ? state.list.join(" ") : scr.uni === "custom" ? scr.custom : UNIVERSES[scr.uni].list;
  return [...new Set(raw.toUpperCase().split(/[\s,;]+/).filter(s => /^[A-Z0-9]{2,10}$/.test(s)))];
}

async function runScreen() {
  readForm();
  let syms;
  try { syms = await universe(); }
  catch (e) { $("scrInfo").textContent = "Không lấy được danh sách mã toàn thị trường: " + e.message; return; }
  const chosen = CRITERIA.filter(c => scr.on.includes(c.id));
  if (!syms.length) { $("scrInfo").textContent = "Danh sách mã đang trống. Thêm mã vào danh mục hoặc chọn danh sách khác."; $("scrBody").innerHTML = ""; return; }
  if (!chosen.length) { $("scrInfo").textContent = "Hãy tick ít nhất một tiêu chí."; $("scrBody").innerHTML = ""; return; }
  $("scan").disabled = true; let done = 0;
  $("scrInfo").textContent = `Đang quét ${syms.length} mã…`;
  const res = await pool(syms, syms.length > 200 ? 12 : 6, async s => { const b = await barsCached(s); $("scrInfo").textContent = `Đang quét ${++done}/${syms.length} mã…`; return b; });
  const rows = [], failed = []; let illiquid = 0;
  syms.forEach((s, k) => {
    const bars = res[k]; if (!Array.isArray(bars) || bars.length < 120) { failed.push(s); return; }
    if (scr.minVal > 0 && avgValue(bars) < scr.minVal) { illiquid++; return; }
    const d = analyze(bars), L = bars.length - 1;
    const hits = chosen.filter(c => { try { return c.test(d, L, scr.n, scr.params); } catch { return false; } });
    const ok = scr.mode === "all" ? hits.length === chosen.length : hits.length > 0;
    if (!ok) return;
    const buy = hits.filter(h => h.side === "MUA").length, sell = hits.length - buy;
    const v = bars.map(b => b.volume);
    rows.push({ s, bars, d, L, hits, buy, sell, verdict: buy > sell ? "MUA" : sell > buy ? "BÁN" : "THEO DÕI",
      chg: bars[L].close / bars[L - 1].close - 1, volK: sum(v, L - 4, L) / (sum(v, L - 9, L - 5) || 1), rsi: d.rsi[L] });
  });
  rows.sort((a, b) => (b.buy - b.sell) - (a.buy - a.sell) || b.hits.length - a.hits.length || b.chg - a.chg);
  const nb = rows.filter(r => r.verdict === "MUA").length, ns = rows.filter(r => r.verdict === "BÁN").length;
  $("scrInfo").innerHTML = `Quét ${syms.length - failed.length - illiquid} mã, phiên ${dmy(rows[0]?.bars.at(-1).date || res.find(Array.isArray)?.at(-1).date || "")}: ` +
    `<b>${rows.length}</b> mã khớp · <span class="up">${nb} báo MUA</span> · <span class="down">${ns} báo BÁN</span>` +
    (illiquid ? ` <span class="muted">· bỏ qua ${illiquid} mã GTGD dưới ${scr.minVal} tỷ/phiên</span>` : "") +
    (failed.length ? ` <span class="muted">· ${failed.length > 15 ? failed.length + " mã không đủ dữ liệu (mới niêm yết hoặc ít giao dịch)" : "không lấy được: " + failed.join(", ")}</span>` : "");
  $("scrBody").innerHTML = rows.length ? rows.map(r => `
    <tr data-s="${r.s}">
      <td class="sym">${r.s}</td><td>${pill(r.verdict)}</td>
      <td class="r num ${dir(r.chg)}">${nf(r.bars[r.L].close)}</td><td class="r num ${dir(r.chg)}">${pct(r.chg, 2)}</td>
      <td class="r num">${nf(r.volK, 1)}×</td><td class="r num">${nf(r.rsi, 0)}</td>
      <td>${spark(r.d.close.slice(-40), 72)}</td>
      <td><div class="chips">${r.hits.map(h => `<span class="chip ${h.side === "MUA" ? "b" : "s"}">${short(h)}</span>`).join("")}</div></td></tr>`).join("")
    : `<tr><td colspan="8" class="empty">Không có mã nào khớp. Thử tăng số phiên xét hoặc chọn chế độ "Khớp bất kỳ".</td></tr>`;
  $("scan").disabled = false;
  scr.lastRun = Date.now();
}
const SHORT = { accum: "Gom hàng (OBV)", cmf: "CMF > 0", updown: "KL tăng > giảm", pocket: "Pocket pivot", distrib: "Phân phối", trend: "Xu hướng mạnh", brkvol: "Breakout + KL", near52: "Gần đỉnh 52T", rsi2: "RSI(2) thấp", squeeze: "Nén BB bứt phá", golden: "Giao cắt vàng",
  ma50vol: "Gãy MA50 + KL", death: "Giao cắt tử thần", rsi2exit: "Giá > MA5", ma2up: "MA20↗MA50", ma3up: "MA20>50>100", ma3conv: "3 MA hội tụ", vol5: "KL 5p ×" , macdup: "MACD↗", rsiup: "RSI>30", brk20: "Vượt đỉnh 20p",
  ma200: "Trên MA200", ma2dn: "MA20↘MA50", ma3dn: "MA20<50<100", macddn: "MACD↘", rsidn: "RSI<70", vol5dn: "KL tăng, giá giảm", brkdn: "Thủng đáy 20p", mal200: "Thủng MA200" };
const short = h => h.id === "vol5" ? `KL 5p ×${scr.params.volK}` : SHORT[h.id];

$("presets").onclick = e => {
  const b = e.target.closest("[data-pre]"); if (!b) return; const p = PRESETS[+b.dataset.pre];
  readForm();
  scr.on = [...p.on]; scr.mode = p.mode; scr.n = p.n; store.set("ck.screener", scr); renderCriteria(); runScreen();
};
$("scrForm").onsubmit = e => { e.preventDefault(); runScreen(); };
$("scrForm").onchange = e => { if (e.target.id === "uni") readForm(); };
$("scrBody").onclick = e => {
  const tr = e.target.closest("tr[data-s]"); if (!tr) return;
  const s = tr.dataset.s, bars = cache[s]?.bars; if (!bars) return;
  state.rows[s] = summarize(s, bars); state.sel = s; showTab("chart"); renderDetail();
};
renderCriteria();
runScreen();
setInterval(() => { if (marketOpen() && !document.hidden && $("tab-scan").hidden === false && !MARKETS[scr.uni]) runScreen(); }, 5 * 60_000);
