// Danh sách toàn bộ mã niêm yết HOSE/HNX/UPCoM từ VNDirect, cùng định dạng với /api/symbols của serve.py.
const URLS = [
  "https://dchart-api.vndirect.com.vn/dchart/search?limit=5000&query=&type=stock&exchange=",
  "https://finfo-api.vndirect.com.vn/v4/stocks?q=type:stock~status:listed&fields=code,floor,type,status&size=3000",
  "https://finfo-api.vndirect.com.vn/v4/stocks?q=type:STOCK~status:LISTED&fields=code,floor,type,status&size=3000",
];

export default async () => {
  let err = "không rõ";
  for (const u of URLS) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      const raw = await r.json();
      // dchart/search trả về dạng UDF: {symbol, exchange}; finfo trả về {code, floor}
      const rows = (Array.isArray(raw) ? raw : raw.data || []).map(x => ({ code: x.code || x.symbol, floor: x.floor || x.exchange }));
      const seen = new Map();
      for (const x of rows) {
        const code = String(x.code || "").toUpperCase(), floor = String(x.floor || "").toUpperCase().replace("UPCOM", "UPCOM").replace(/^HSX$/, "HOSE");
        if (code.length === 3 && ["HOSE", "HNX", "UPCOM"].includes(floor)) seen.set(code, floor);
      }
      if (seen.size > 300) {
        const data = [...seen].sort().map(([code, floor]) => ({ code, floor }));
        return Response.json({ s: "ok", data }, { headers: { "Cache-Control": "public, max-age=86400" } });
      }
      err = `chỉ nhận được ${seen.size} mã`;
    } catch (e) { err = String(e); }
  }
  return Response.json({ s: "error", error: err }, { status: 502 });
};
