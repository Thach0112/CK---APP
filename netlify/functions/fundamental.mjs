// Báo cáo tài chính theo quý cho bộ lọc FA, cùng định dạng với /api/fundamental của serve.py.
// Thử lần lượt Vietcap → TCBS → VNDirect, nguồn nào được thì dùng. Trình duyệt chuẩn hoá bằng web/fa.js.
const VCI_GRAPHQL = "https://trading.vietcap.com.vn/data-mt/graphql";
const VCI_FIELDS = ("ticker yearReport lengthReport revenue revenueGrowth netProfit netProfitGrowth roe roa pe pb eps bvps " +
  "de currentRatio grossMargin netProfitMargin dividend issueShare").split(" ");
const TCBS_URL = (sym, kind) => `https://apipubaws.tcbs.com.vn/tcanalysis/v1/finance/${sym}/${kind}?yearly=0&isAll=true`;
const VND_RATIOS = sym => "https://finfo-api.vndirect.com.vn/v4/ratios/latest?filter=ratioCode:PRICE_TO_EARNINGS,PRICE_TO_BOOK," +
  `ROAE_TR_AVG5Q,ROAA_TR_AVG5Q,EPS_TR,BVPS_CR,DIVIDEND_YIELD&where=code:${sym}&order=reportDate&fields=ratioCode,value,reportDate`;
const UA = { "User-Agent": "Mozilla/5.0" };

async function vci(sym) {
  let fields = [...VCI_FIELDS];
  for (let k = 0; k < 4; k++) {   // trường nào nguồn không còn hỗ trợ thì bỏ đi rồi hỏi lại
    const query = `query Q($ticker: String!, $period: String!) { CompanyFinancialRatio(ticker: $ticker, period: $period) { ratio { ${fields.join(" ")} } period } }`;
    const r = await fetch(VCI_GRAPHQL, { method: "POST", body: JSON.stringify({ query, variables: { ticker: sym, period: "Q" } }),
      headers: { ...UA, "Content-Type": "application/json", Referer: "https://trading.vietcap.com.vn/", Origin: "https://trading.vietcap.com.vn" } });
    const raw = await r.json();
    const bad = fields.filter(f => (raw.errors || []).some(e => String(e.message).includes(`"${f}"`)));
    if (bad.length) { fields = fields.filter(f => !bad.includes(f)); continue; }
    const rows = raw.data?.CompanyFinancialRatio?.ratio || [];
    if (rows.length) return { ratio: rows };
    break;
  }
  throw new Error("Vietcap không có dữ liệu");
}
async function tcbs(sym) {
  const ratio = await (await fetch(TCBS_URL(sym, "financialratio"), { headers: UA })).json();
  if (!Array.isArray(ratio) || !ratio.length) throw new Error("TCBS không có dữ liệu");
  const income = await fetch(TCBS_URL(sym, "incomestatement"), { headers: UA }).then(r => r.json()).catch(() => []);
  return { ratio, income: Array.isArray(income) ? income : [] };
}
async function vnd(sym) {
  const raw = await (await fetch(VND_RATIOS(sym), { headers: UA })).json();
  if (!raw.data?.length) throw new Error("VNDirect không có dữ liệu");
  return raw;
}

export default async (req) => {
  const sym = (new URL(req.url).searchParams.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (!sym) return Response.json({ s: "error", error: "thiếu mã" }, { status: 400 });
  const errs = [];
  for (const [name, fn] of [["vci", vci], ["tcbs", tcbs], ["vnd", vnd]]) {
    try {
      return Response.json({ s: "ok", source: name, data: await fn(sym) }, { headers: { "Cache-Control": "public, max-age=43200" } });
    } catch (e) { errs.push(`${name}: ${e.message || e}`); }
  }
  return Response.json({ s: "error", error: errs.join("; ") }, { status: 502 });
};
