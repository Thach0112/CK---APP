"""Quy tắc tín hiệu Mua/Bán dựa trên chỉ báo. Mỗi quy tắc trả về điểm +1 (mua), -1 (bán) hoặc 0."""
import pandas as pd

from .indicators import add_all


def _cross_up(a: pd.Series, b: pd.Series) -> pd.Series:
    return (a > b) & (a.shift() <= b.shift())


def _cross_down(a: pd.Series, b: pd.Series) -> pd.Series:
    return (a < b) & (a.shift() >= b.shift())


RULES = {
    "MA20 cắt MA50": lambda d: _cross_up(d.ma20, d.ma50).astype(int) - _cross_down(d.ma20, d.ma50).astype(int),
    "Giá trên/dưới MA200": lambda d: (d.close > d.ma200).astype(int) - (d.close < d.ma200).astype(int),
    "RSI quá bán/quá mua": lambda d: _cross_up(d.rsi14, pd.Series(30, index=d.index)).astype(int)
    - _cross_down(d.rsi14, pd.Series(70, index=d.index)).astype(int),
    "MACD cắt Signal": lambda d: _cross_up(d.macd, d.macd_signal).astype(int)
    - _cross_down(d.macd, d.macd_signal).astype(int),
    "Bollinger chạm biên": lambda d: (d.close < d.bb_lower).astype(int) - (d.close > d.bb_upper).astype(int),
    "Khối lượng đột biến": lambda d: ((d.vol_ratio > 1.5) & (d.close > d.close.shift())).astype(int)
    - ((d.vol_ratio > 1.5) & (d.close < d.close.shift())).astype(int),
}


def score(df: pd.DataFrame) -> pd.DataFrame:
    """Tính chỉ báo, điểm từng quy tắc, tổng điểm và khuyến nghị cho từng phiên."""
    d = add_all(df)
    for name, rule in RULES.items():
        d[f"sig: {name}"] = rule(d).fillna(0).astype(int)
    sig_cols = [c for c in d.columns if c.startswith("sig: ")]
    d["score"] = d[sig_cols].sum(axis=1)
    d["action"] = d["score"].map(lambda s: "MUA" if s >= 2 else ("BÁN" if s <= -2 else "THEO DÕI"))
    return d


def latest_summary(symbol: str, df: pd.DataFrame) -> dict:
    d = score(df)
    last = d.iloc[-1]
    return {
        "symbol": symbol,
        "date": d.index[-1].date() if hasattr(d.index[-1], "date") else d.index[-1],
        "close": round(float(last.close), 2),
        "rsi14": round(float(last.rsi14), 1),
        "macd_hist": round(float(last.macd_hist), 3),
        "vol_ratio": round(float(last.vol_ratio), 2),
        "above_ma200": bool(last.close > last.ma200),
        "score": int(last.score),
        "action": last.action,
        "reasons": [c[5:] for c in d.columns if c.startswith("sig: ") and last[c] != 0],
    }


def screen(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Lọc nhiều mã cùng lúc, sắp xếp theo điểm giảm dần."""
    rows = [latest_summary(sym, df) for sym, df in data.items() if len(df) >= 50]
    return pd.DataFrame(rows).sort_values("score", ascending=False).reset_index(drop=True)
