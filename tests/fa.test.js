// Kiểm thử bộ lọc FA. Chạy: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { FA, FA_CRITERIA } = require("../web/fa.js");

// 8 quý: LNST tăng 30% so với cùng kỳ, 1 tỷ cổ phiếu
function vciRaw() {
  const ratio = [];
  for (let y = 2024; y <= 2025; y++) for (let q = 1; q <= 4; q++) {
    const base = y === 2024 ? 100e9 : 130e9;
    ratio.push({ ticker: "AAA", yearReport: y, lengthReport: q, revenue: base * 10, netProfit: base, roe: 0.2, roa: 0.08, pe: 10, pb: 1.5,
      eps: 400, bvps: 20000, de: 0.5, currentRatio: 1.5, netProfitMargin: 0.1, dividend: 0.05, issueShare: 1e9 });
  }
  ratio.push({ ticker: "AAA", yearReport: 2025, lengthReport: 5, revenue: 1 });   // dòng cả năm: phải bị bỏ qua
  return { ratio };
}
const crit = id => FA_CRITERIA.find(c => c.id === id);
const params = Object.fromEntries(FA_CRITERIA.filter(c => c.param).map(c => [c.param.key, c.param.val]));

test("chuẩn hoá Vietcap: mới nhất trước, bỏ dòng cả năm", () => {
  const f = FA.normalize("vci", vciRaw());
  assert.equal(f.quarters.length, 8);
  assert.deepEqual([f.quarters[0].year, f.quarters[0].quarter], [2025, 4]);
});

test("chỉ số: EPS 4 quý, P/E theo giá hiện tại, tăng trưởng cùng kỳ", () => {
  const m = FA.metrics(FA.normalize("vci", vciRaw()), 52);   // giá 52 nghìn đồng
  assert.equal(m.eps, 520);                                   // 4 × 130 tỷ / 1 tỷ cp
  assert.ok(Math.abs(m.pe - 100) < 1e-9);
  assert.ok(Math.abs(m.pb - 2.6) < 1e-9);
  assert.ok(Math.abs(m.npYoY - 0.3) < 1e-9);
  assert.ok(Math.abs(m.npTtmYoY - 0.3) < 1e-9);
  assert.equal(m.streak, 4);
  assert.ok(Math.abs(m.peg - 100 / 30) < 1e-9);
  assert.equal(m.period, "Q4/2025");
});

test("tiêu chí FA", () => {
  const m = FA.metrics(FA.normalize("vci", vciRaw()), 5.2);   // P/E 10
  for (const id of ["fa_pe", "fa_np", "fa_rev", "fa_ttm", "fa_streak", "fa_roe", "fa_roe4", "fa_de", "fa_cr", "fa_dy", "fa_graham"])
    assert.ok(crit(id).test(m, params), id);
  for (const id of ["fa_drop", "fa_loss", "fa_pehigh", "fa_accel"]) assert.ok(!crit(id).test(m, params), id);
});

test("thiếu dữ liệu thì không khớp (ví dụ ngân hàng không có D/E)", () => {
  const raw = vciRaw(); raw.ratio.forEach(r => { delete r.de; delete r.currentRatio; });
  const m = FA.metrics(FA.normalize("vci", raw), 5.2);
  assert.equal(m.de, null);
  assert.ok(!crit("fa_de").test(m, params));
  assert.ok(!crit("fa_cr").test(m, params));
});

test("tỷ lệ dạng phần trăm được đổi về thập phân", () => {
  const raw = vciRaw(); raw.ratio.forEach(r => { r.roe = 20; });
  assert.ok(Math.abs(FA.metrics(FA.normalize("vci", raw), 50).roe - 0.2) < 1e-9);
});

test("chuẩn hoá TCBS: ghép chỉ số với kết quả kinh doanh, lợi nhuận tỷ đồng", () => {
  const ratio = [{ year: 2025, quarter: 2, earningPerShare: 5000, bookValuePerShare: 25000, roe: 0.25, debtOnEquity: 0.3, priceToEarning: 12 },
    { year: 2025, quarter: 1, earningPerShare: 4800, roe: 0.24 }];
  const income = [{ year: 2025, quarter: 2, revenue: 1000, shareHolderIncome: 200, yearShareHolderIncomeGrowth: -0.1, yearRevenueGrowth: 0.05 },
    { year: 2025, quarter: 1, revenue: 900, shareHolderIncome: 150, yearShareHolderIncomeGrowth: -0.2 }];
  const f = FA.normalize("tcbs", { ratio, income });
  assert.equal(f.quarters[0].netProfit, 200e9);
  const m = FA.metrics(f, 60);
  assert.equal(m.pe, 12);                       // 60 000 / 5 000
  assert.equal(m.npYoY, -0.1);                  // không đủ quý để tự tính → dùng số của nguồn
  assert.ok(crit("fa_drop").test(m, params));
});

test("chuẩn hoá VNDirect: một quý từ ảnh chụp chỉ số", () => {
  const f = FA.normalize("vnd", { data: [{ ratioCode: "PRICE_TO_EARNINGS", value: 9, reportDate: "2025-09-30" },
    { ratioCode: "ROAE_TR_AVG5Q", value: 0.18, reportDate: "2025-09-30" }, { ratioCode: "EPS_TR", value: 3000, reportDate: "2025-09-30" }] });
  const m = FA.metrics(f, 30);
  assert.equal(m.period, "Q3/2025");
  assert.equal(m.pe, 10);
  assert.equal(m.roe, 0.18);
});
