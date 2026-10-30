// Phân tích cơ bản (FA): chuẩn hoá báo cáo tài chính theo quý từ nhiều nguồn, tính chỉ số theo giá hiện tại,
// và các tiêu chí lọc FA. Dùng chung cho trình duyệt và kiểm thử Node (tests/fa.test.js).
const FA = {
  // Đưa dữ liệu thô của từng nguồn về cùng dạng: danh sách quý, mới nhất trước.
  // Mỗi quý: { year, quarter, revenue, netProfit (đồng), eps, bvps (đồng/cp), pe, pb, roe, roa, de, cr, gm, nm, dy (tỷ lệ, 0,15 = 15%) }
  normalize(source, raw) {
    const num = v => v === null || v === undefined || v === "" || !isFinite(+v) ? null : +v;
    let q = [];
    if (source === "vci") {
      q = (raw?.CompanyFinancialRatio?.ratio || raw?.ratio || []).filter(r => +r.lengthReport >= 1 && +r.lengthReport <= 4).map(r => ({
        year: +r.yearReport, quarter: +r.lengthReport, revenue: num(r.revenue), netProfit: num(r.netProfit),
        revenueGrowth: num(r.revenueGrowth), profitGrowth: num(r.netProfitGrowth),
        eps: num(r.eps), bvps: num(r.bvps), pe: num(r.pe), pb: num(r.pb), roe: num(r.roe), roa: num(r.roa),
        de: num(r.de), cr: num(r.currentRatio), gm: num(r.grossMargin), nm: num(r.netProfitMargin), dy: num(r.dividend), shares: num(r.issueShare) }));
    } else if (source === "tcbs") {
      // TCBS: doanh thu, lợi nhuận tính bằng tỷ đồng → đổi ra đồng
      const inc = new Map((raw?.income || []).map(r => [`${r.year}-${r.quarter}`, r]));
      q = (raw?.ratio || []).filter(r => +r.quarter >= 1 && +r.quarter <= 4).map(r => {
        const i = inc.get(`${r.year}-${r.quarter}`) || {}, bil = v => num(v) === null ? null : num(v) * 1e9;
        return { year: +r.year, quarter: +r.quarter, revenue: bil(i.revenue), netProfit: bil(i.shareHolderIncome ?? i.postTaxProfit),
          revenueGrowth: num(i.yearRevenueGrowth), profitGrowth: num(i.yearShareHolderIncomeGrowth),
          eps: num(r.earningPerShare), bvps: num(r.bookValuePerShare), pe: num(r.priceToEarning), pb: num(r.priceToBook),
          roe: num(r.roe), roa: num(r.roa), de: num(r.debtOnEquity), cr: num(r.currentPayment),
          gm: num(r.grossProfitMargin), nm: num(r.postTaxMargin), dy: num(r.dividend), epsTtm: true };
      });
    } else if (source === "vnd") {
      // VNDirect chỉ có ảnh chụp chỉ số mới nhất, không có lịch sử quý
      const v = Object.fromEntries((raw?.data || []).map(r => [r.ratioCode || r.itemCode, num(r.value)]));
      const d = (raw?.data || []).map(r => r.reportDate).filter(Boolean).sort().at(-1) || "";
      const y = +d.slice(0, 4) || null, m = +d.slice(5, 7) || 0;
      q = [{ year: y, quarter: m ? Math.ceil(m / 3) : null, eps: v.EPS_TR ?? null, bvps: v.BVPS_CR ?? null, pe: v.PRICE_TO_EARNINGS ?? null,
        pb: v.PRICE_TO_BOOK ?? null, roe: v.ROAE_TR_AVG5Q ?? null, roa: v.ROAA_TR_AVG5Q ?? null, dy: v.DIVIDEND_YIELD ?? null, epsTtm: true }];
    }
    // Tỷ lệ phải ở dạng thập phân; nguồn nào trả về phần trăm (ROE 25 thay vì 0,25) thì đổi lại
    for (const x of q) for (const k of ["roe", "roa", "gm", "nm", "dy"]) if (x[k] !== null && x[k] !== undefined && Math.abs(x[k]) > 3) x[k] /= 100;
    q = q.filter(x => x.year).sort((a, b) => b.year - a.year || b.quarter - a.quarter);
    return { source, quarters: q.slice(0, 12) };
  },

  // Tính các chỉ số dùng để lọc. price: giá hiện tại (nghìn đồng). Thiếu dữ liệu thì để null.
  metrics(f, price) {
    const q = f?.quarters || [], q0 = q[0];
    if (!q0) return null;
    const idx = x => x.year * 4 + x.quarter;
    const same = (x, back) => q.find(y => idx(y) === idx(x) - back);
    const growth = (a, b) => a !== null && b !== null && b > 0 ? a / b - 1 : null;
    // Tăng trưởng so với cùng kỳ năm trước của từng quý: tự tính khi có đủ quý, không thì dùng số của nguồn
    const yoy = (x, key, fb) => { const p = same(x, 4); const g = p ? growth(x[key], p[key]) : null; return g !== null ? g : x[fb] ?? null; };
    const profitYoY = q.map(x => yoy(x, "netProfit", "profitGrowth")), revenueYoY = q.map(x => yoy(x, "revenue", "revenueGrowth"));
    // Lợi nhuận 4 quý gần nhất (TTM) so với 4 quý trước đó, chỉ khi các quý liên tiếp
    const run = n => q.length >= n && q.slice(0, n).every((x, i) => idx(x) === idx(q0) - i && x.netProfit !== null);
    const ttm = run(4) ? q.slice(0, 4).reduce((s, x) => s + x.netProfit, 0) : null;
    const ttmPrev = run(8) ? q.slice(4, 8).reduce((s, x) => s + x.netProfit, 0) : null;
    let eps = q0.eps;
    if (ttm !== null && q0.shares > 0) eps = ttm / q0.shares;
    const px = price > 0 ? price * 1000 : null;
    const pe = px && eps ? px / eps : q0.pe, pb = px && q0.bvps > 0 ? px / q0.bvps : q0.pb;
    let streak = 0; for (const g of profitYoY) { if (g !== null && g > 0) streak++; else break; }
    const npTtmYoY = growth(ttm, ttmPrev);
    const g = npTtmYoY ?? profitYoY[0];
    return { period: `Q${q0.quarter}/${q0.year}`, source: f.source, eps, pe, pb, peg: pe > 0 && g > 0 ? pe / (g * 100) : null,
      roe: q0.roe, roa: q0.roa, de: q0.de, cr: q0.cr, gm: q0.gm, nm: q0.nm, dy: q0.dy,
      revYoY: revenueYoY[0], npYoY: profitYoY[0], npYoYPrev: profitYoY[1] ?? null, npTtmYoY, streak,
      roeHist: q.slice(0, 4).map(x => x.roe), npHist: profitYoY.slice(0, 4) };
  },
};

// Tiêu chí FA. test(m, p): m = FA.metrics(...), p = tham số người dùng (đơn vị %, lần như hiển thị).
// Tất cả các tiêu chí FA được tick là điều kiện bắt buộc (phải đạt hết).
const hasV = v => v !== null && v !== undefined && isFinite(v);
const FA_CRITERIA = [
  // Định giá
  { id: "fa_pe", fa: "val", side: "MUA", label: "P/E dương và không quá", param: { key: "peMax", val: 15, unit: "lần" },
    note: "tính theo giá hiện tại và EPS 4 quý gần nhất", test: (m, p) => hasV(m.pe) && m.pe > 0 && m.pe <= p.peMax },
  { id: "fa_pb", fa: "val", side: "MUA", label: "P/B không quá", param: { key: "pbMax", val: 2, unit: "lần" }, test: (m, p) => hasV(m.pb) && m.pb > 0 && m.pb <= p.pbMax },
  { id: "fa_graham", fa: "val", side: "MUA", label: "Giá trị Graham: P/E × P/B ≤ 22,5", note: "và P/E dương (Benjamin Graham)",
    test: m => hasV(m.pe) && hasV(m.pb) && m.pe > 0 && m.pb > 0 && m.pe * m.pb <= 22.5 },
  { id: "fa_peg", fa: "val", side: "MUA", label: "PEG (P/E ÷ % tăng trưởng LNST) không quá", param: { key: "pegMax", val: 1, unit: "" },
    note: "tăng trưởng giá hợp lý (Peter Lynch)", test: (m, p) => hasV(m.peg) && m.peg <= p.pegMax },
  { id: "fa_dy", fa: "val", side: "MUA", label: "Tỷ suất cổ tức từ", param: { key: "dyMin", val: 4, unit: "%" }, test: (m, p) => hasV(m.dy) && m.dy * 100 >= p.dyMin },
  // Tăng trưởng
  { id: "fa_np", fa: "grow", side: "MUA", label: "LNST quý gần nhất tăng so với cùng kỳ từ", param: { key: "npMin", val: 20, unit: "%" },
    note: "CANSLIM chữ C dùng mức 25%", test: (m, p) => hasV(m.npYoY) && m.npYoY * 100 >= p.npMin },
  { id: "fa_rev", fa: "grow", side: "MUA", label: "Doanh thu quý gần nhất tăng so với cùng kỳ từ", param: { key: "revMin", val: 15, unit: "%" },
    test: (m, p) => hasV(m.revYoY) && m.revYoY * 100 >= p.revMin },
  { id: "fa_ttm", fa: "grow", side: "MUA", label: "LNST 4 quý gần nhất tăng so với 4 quý trước từ", param: { key: "ttmMin", val: 15, unit: "%" },
    note: "tăng trưởng bền, không chỉ một quý đột biến", test: (m, p) => hasV(m.npTtmYoY) && m.npTtmYoY * 100 >= p.ttmMin },
  { id: "fa_streak", fa: "grow", side: "MUA", label: "LNST tăng so với cùng kỳ liên tiếp", param: { key: "streak", val: 3, unit: "quý" }, test: (m, p) => m.streak >= p.streak },
  { id: "fa_accel", fa: "grow", side: "MUA", label: "Lợi nhuận tăng tốc: tăng trưởng quý này cao hơn quý trước",
    test: m => hasV(m.npYoY) && hasV(m.npYoYPrev) && m.npYoY > 0 && m.npYoY > m.npYoYPrev },
  // Hiệu quả và sức khoẻ tài chính
  { id: "fa_roe", fa: "qual", side: "MUA", label: "ROE từ", param: { key: "roeMin", val: 15, unit: "%" }, test: (m, p) => hasV(m.roe) && m.roe * 100 >= p.roeMin },
  { id: "fa_roe4", fa: "qual", side: "MUA", label: "ROE ổn định: cả 4 quý gần nhất đều từ", param: { key: "roe4Min", val: 12, unit: "%" },
    note: "doanh nghiệp có lợi thế cạnh tranh bền (kiểu Buffett)", test: (m, p) => m.roeHist.length === 4 && m.roeHist.every(r => hasV(r) && r * 100 >= p.roe4Min) },
  { id: "fa_roa", fa: "qual", side: "MUA", label: "ROA từ", param: { key: "roaMin", val: 7, unit: "%" }, test: (m, p) => hasV(m.roa) && m.roa * 100 >= p.roaMin },
  { id: "fa_nm", fa: "qual", side: "MUA", label: "Biên lợi nhuận ròng từ", param: { key: "nmMin", val: 10, unit: "%" }, test: (m, p) => hasV(m.nm) && m.nm * 100 >= p.nmMin },
  { id: "fa_de", fa: "qual", side: "MUA", label: "Nợ / vốn chủ (D/E) không quá", param: { key: "deMax", val: 1, unit: "lần" },
    note: "ngân hàng, chứng khoán không có chỉ số này nên sẽ bị loại", test: (m, p) => hasV(m.de) && m.de >= 0 && m.de <= p.deMax },
  { id: "fa_cr", fa: "qual", side: "MUA", label: "Thanh toán hiện hành từ", param: { key: "crMin", val: 1.2, unit: "lần" }, test: (m, p) => hasV(m.cr) && m.cr >= p.crMin },
  // Cảnh báo cơ bản xấu
  { id: "fa_drop", fa: "warn", side: "BÁN", label: "LNST giảm so với cùng kỳ 2 quý liên tiếp",
    test: m => hasV(m.npYoY) && hasV(m.npYoYPrev) && m.npYoY < 0 && m.npYoYPrev < 0 },
  { id: "fa_loss", fa: "warn", side: "BÁN", label: "Thua lỗ: EPS 4 quý gần nhất âm", test: m => hasV(m.eps) && m.eps < 0 },
  { id: "fa_pehigh", fa: "warn", side: "BÁN", label: "Định giá cao: P/E trên", param: { key: "peHigh", val: 30, unit: "lần" }, test: (m, p) => hasV(m.pe) && m.pe > p.peHigh },
];
const FA_SHORT = { fa_pe: "P/E thấp", fa_pb: "P/B thấp", fa_graham: "Graham", fa_peg: "PEG ≤ 1", fa_dy: "Cổ tức cao", fa_np: "LN quý tăng", fa_rev: "DT quý tăng",
  fa_ttm: "LN 4 quý tăng", fa_streak: "LN tăng liên tiếp", fa_accel: "LN tăng tốc", fa_roe: "ROE cao", fa_roe4: "ROE ổn định", fa_roa: "ROA cao", fa_nm: "Biên LN cao",
  fa_de: "Nợ thấp", fa_cr: "Thanh khoản tốt", fa_drop: "LN giảm 2 quý", fa_loss: "Thua lỗ", fa_pehigh: "P/E cao" };

if (typeof module !== "undefined") module.exports = { FA, FA_CRITERIA, FA_SHORT };
