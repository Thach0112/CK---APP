// Proxy lấy giá ngày từ VNDirect, cùng định dạng với /api/history của serve.py.
const VNDIRECT_URL = "https://dchart-api.vndirect.com.vn/dchart/history";
const RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "D", "W", "M"]);

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const symbol = (q.get("symbol") || "FPT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "FPT";
  const days = Math.min(Math.max(parseInt(q.get("days") || "500", 10) || 500, 1), 3000);
  const resolution = RESOLUTIONS.has((q.get("resolution") || "D").toUpperCase()) ? (q.get("resolution") || "D").toUpperCase() : "D";
  const now = Math.floor(Date.now() / 1000);
  const url = `${VNDIRECT_URL}?resolution=${resolution}&symbol=${symbol}&from=${now - days * 86400}&to=${now}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    return new Response(await r.text(), { status: r.ok ? 200 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return Response.json({ s: "error", error: String(e) }, { status: 502 });
  }
};
