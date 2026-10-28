"""Các chỉ báo phân tích kỹ thuật (TA). Đầu vào: DataFrame có cột open, high, low, close, volume."""
import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """RSI theo cách làm mượt của Wilder."""
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0).where(gain.notna())


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return pd.DataFrame({"macd": line, "macd_signal": sig, "macd_hist": line - sig})


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return pd.DataFrame({"bb_mid": mid, "bb_upper": mid + k * sd, "bb_lower": mid - k * sd})


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def add_all(df: pd.DataFrame) -> pd.DataFrame:
    """Thêm toàn bộ chỉ báo mặc định vào bản sao của df."""
    out = df.copy()
    c = out["close"]
    for n in (20, 50, 200):
        out[f"ma{n}"] = sma(c, n)
    out["ema9"] = ema(c, 9)
    out["ema21"] = ema(c, 21)
    out["rsi14"] = rsi(c, 14)
    out = out.join(macd(c)).join(bollinger(c))
    out["atr14"] = atr(out, 14)
    out["vol_ma20"] = sma(out["volume"], 20)
    out["vol_ratio"] = out["volume"] / out["vol_ma20"]
    return out
