// Kiểm thử bộ kiểm định chiến lược (web/backtest.js). Chạy: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { analyze } = require("../web/ta.js");
const { backtest, backtestAll, FEE, STRATEGIES } = require("../web/backtest.js");

const day = i => new Date(Date.UTC(2020, 0, 1) + i * 86400e3).toISOString().slice(0, 10);
const mk = closes => closes.map((c, i) => ({ date: day(i), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e5 }));
// Chiến lược giả: mua/bán đúng các phiên chỉ định
const fake = (buyAt, sellAt) => ({ id: "t", name: "t", entry: (d, i) => buyAt.includes(i), exit: (d, i) => sellAt.includes(i) });

test("khớp lệnh theo giá mở cửa phiên sau tín hiệu và trừ phí, thuế", () => {
  const bars = mk(Array.from({ length: 30 }, () => 10));
  bars[6].open = 11;
  const r = backtest(analyze(bars), fake([5], [10]), { from: 1 });
  assert.strictEqual(r.trades.length, 1);
  const t = r.trades[0];
  assert.strictEqual(t.buy, 6); assert.strictEqual(t.buyPx, 11); assert.strictEqual(t.sell, 11);
  const expect = 10 / 11 * (1 - FEE.buy) * (1 - FEE.sell) - 1;
  assert.ok(Math.abs(t.ret - expect) < 1e-12);
  assert.ok(Math.abs(r.ret - expect) < 1e-12);
});

test("hàng về T+2 mới được bán", () => {
  const bars = mk(Array.from({ length: 30 }, () => 10));
  const r = backtest(analyze(bars), fake([5], [6]), { from: 1 });   // mua phiên 6, tín hiệu bán ngay phiên 6
  assert.strictEqual(r.trades[0].sell, 8);
});

test("cắt lỗ khi giá chạm mức đặt", () => {
  const c = Array.from({ length: 30 }, (_, i) => (i < 12 ? 10 : 8));
  const r = backtest(analyze(mk(c)), fake([5], []), { from: 1, stop: 0.07 });
  assert.strictEqual(r.trades.length, 1);
  assert.strictEqual(r.trades[0].why, "Cắt lỗ");
  assert.strictEqual(r.trades[0].sell, 12);
  assert.strictEqual(r.trades[0].sellPx, 8);   // mở cửa đã dưới mức cắt lỗ thì khớp giá mở cửa
  assert.strictEqual(r.next, "ĐỨNG NGOÀI");
});

test("lệnh chưa đóng được tính vào kết quả và báo việc cần làm phiên tới", () => {
  const bars = mk(Array.from({ length: 30 }, (_, i) => 10 + i * 0.1));
  const r = backtest(analyze(bars), fake([5], []), { from: 1 });
  assert.strictEqual(r.trades.length, 0);
  assert.ok(r.open && r.open.ret > 0);
  assert.strictEqual(r.next, "GIỮ");
  assert.strictEqual(backtest(analyze(bars), fake([29], []), { from: 1 }).next, "MUA");
});

test("kiểm định toàn bộ chiến lược trên dữ liệu nhiều năm", () => {
  let p = 20, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const c = Array.from({ length: 1300 }, () => (p *= 1 + (rnd() - 0.49) * 0.04));
  const out = backtestAll(mk(c), { years: 3, stop: 0.07 });
  assert.strictEqual(out.res.length, STRATEGIES.length);
  for (let k = 1; k < out.res.length; k++) assert.ok(out.res[k - 1].ret >= out.res[k].ret);
  assert.ok(out.from > 200 && !out.short);
  for (const r of out.res) {
    assert.ok(r.mdd <= 0 && r.mdd > -1);
    for (const t of r.trades) assert.ok(t.sell >= t.buy + 2 && t.buy >= out.from);
  }
  assert.ok(out.res.includes(out.best));
});
