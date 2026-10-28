// Danh mục của tôi: cổ phiếu đang nắm giữ, lãi/lỗ và cảnh báo BÁN / cắt lỗ theo tiêu chí TA.
const pf = store.get("ck.portfolio", { items: [], stop: 7 });
const savePf = () => store.set("ck.portfolio", pf);

async function renderPortfolio() {
  $("pfStop").value = pf.stop;
  if (!pf.items.length) {
    $("pfSum").innerHTML = "";
    $("pfBody").innerHTML = `<tr><td colspan="10" class="empty">Chưa có cổ phiếu nào. Nhập mã, số lượng và giá vốn ở trên để bắt đầu theo dõi danh mục.</td></tr>`;
    return;
  }
  $("pfInfo").textContent = "Đang tải giá…";
  const res = await pool(pf.items.map(x => x.sym), 6, barsCached);
  let cost = 0, value = 0, alerts = 0;
  const rows = pf.items.map((it, k) => {
    const bars = res[k];
    if (!Array.isArray(bars) || bars.length < 120) return `<tr><td class="sym">${it.sym}</td><td colspan="8" class="err">Không lấy được dữ liệu</td><td><button class="x show" data-pdel="${k}" aria-label="Xoá ${it.sym}">×</button></td></tr>`;
    const d = analyze(bars), L = bars.length - 1, px = bars[L].close, chg = px / bars[L - 1].close - 1;
    const hits = CRITERIA.filter(c => { try { return c.test(d, L, scr.n, scr.params); } catch { return false; } });
    const sell = hits.filter(h => h.side === "BÁN"), buy = hits.filter(h => h.side === "MUA");
    const pl = (px - it.cost) / it.cost, stopHit = pl <= -pf.stop / 100;
    const verdict = stopHit ? ["BÁN", "Chạm cắt lỗ"] : sell.length > buy.length ? ["BÁN", "Cân nhắc bán"] : buy.length ? ["MUA", "Giữ / mua thêm"] : ["THEO DÕI", "Tiếp tục giữ"];
    if (verdict[0] === "BÁN") alerts++;
    cost += it.cost * it.qty; value += px * it.qty;
    return `<tr data-k="${k}" class="${verdict[0] === "BÁN" ? "warn" : ""}">
      <td class="sym">${it.sym}</td>
      <td class="r num">${it.qty.toLocaleString("vi-VN")}</td>
      <td class="r num">${nf(it.cost)}</td>
      <td class="r num ${dir(chg)}">${nf(px)}</td>
      <td class="r num ${dir(chg)}">${pct(chg, 2)}</td>
      <td class="r num ${dir(pl)}">${pct(pl, 1)}</td>
      <td class="r num ${dir(pl)}">${money((px - it.cost) * it.qty)}</td>
      <td><span class="pill ${verdict[0]}">${verdict[1]}</span></td>
      <td><div class="chips">${hits.map(h => `<span class="chip ${h.side === "MUA" ? "b" : "s"}">${short(h)}</span>`).join("") || (stopHit ? "" : '<span class="muted">Không có tín hiệu mới</span>')}${stopHit ? `<span class="chip s">Lỗ quá ${pf.stop}%</span>` : ""}</div></td>
      <td><button class="x show" data-pdel="${k}" aria-label="Xoá ${it.sym}">×</button></td></tr>`;
  });
  $("pfBody").innerHTML = rows.join("");
  const pl = value - cost;
  $("pfSum").innerHTML = [["Tổng vốn", money(cost)], ["Giá trị hiện tại", money(value)],
    ["Lãi / lỗ", `<span class="${dir(pl)}">${money(pl)} (${pct(cost ? pl / cost : 0)})</span>`],
    ["Cảnh báo bán", `<span class="${alerts ? "down" : ""}">${alerts} mã</span>`]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  $("pfInfo").textContent = `Tín hiệu xét trong ${scr.n} phiên gần nhất, dùng cùng tiêu chí và tham số với Bộ lọc tín hiệu (không cần tick).`;
}
// Giá cổ phiếu tính bằng nghìn đồng → nhân 1000 ra đồng
const money = v => (v < 0 ? "−" : "") + Math.abs(v * 1000).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + " đ";

$("pfForm").onsubmit = e => {
  e.preventDefault();
  const sym = $("pfSym").value.trim().toUpperCase(), qty = +$("pfQty").value, cost = +String($("pfCost").value).replace(",", ".");
  if (!/^[A-Z0-9]{2,10}$/.test(sym) || !(qty > 0) || !(cost > 0)) { $("pfInfo").textContent = "Nhập đủ mã, số lượng và giá vốn (nghìn đồng, ví dụ 57,1)."; return; }
  const ex = pf.items.find(x => x.sym === sym);
  if (ex) { ex.cost = (ex.cost * ex.qty + cost * qty) / (ex.qty + qty); ex.qty += qty; }   // mua thêm: tính lại giá vốn bình quân
  else pf.items.push({ sym, qty, cost });
  savePf(); $("pfForm").reset(); renderPortfolio();
};
$("pfStop").onchange = e => { pf.stop = Math.max(0, +e.target.value || 0); savePf(); renderPortfolio(); };
$("pfBody").onclick = e => {
  const del = e.target.closest("[data-pdel]");
  if (del) { pf.items.splice(+del.dataset.pdel, 1); savePf(); renderPortfolio(); return; }
  const tr = e.target.closest("tr[data-k]"); if (!tr) return;
  const s = pf.items[+tr.dataset.k].sym, bars = cache[s]?.bars; if (!bars) return;
  state.rows[s] = summarize(s, bars); state.sel = s; showTab("chart"); renderDetail();
};
showTab(store.get("ck.tab", "scan"));
