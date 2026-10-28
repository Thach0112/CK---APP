"""Nguồn dữ liệu giá. Mặc định lấy giá ngày HOSE/HNX/UPCoM từ API công khai của VNDirect (dchart).

Nếu không có mạng thì dùng dữ liệu mẫu (sample) để thử giao diện và chỉ báo.
"""
import time
import zlib

import numpy as np
import pandas as pd
import requests

VNDIRECT_URL = "https://dchart-api.vndirect.com.vn/dchart/history"


def fetch_vndirect(symbol: str, days: int = 500) -> pd.DataFrame:
    now = int(time.time())
    params = {"resolution": "D", "symbol": symbol.upper(), "from": now - days * 86400, "to": now}
    r = requests.get(VNDIRECT_URL, params=params, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    j = r.json()
    if j.get("s") != "ok" or not j.get("t"):
        raise ValueError(f"Không có dữ liệu cho mã {symbol}")
    df = pd.DataFrame({"open": j["o"], "high": j["h"], "low": j["l"], "close": j["c"], "volume": j["v"]},
                      index=pd.to_datetime(j["t"], unit="s").normalize())
    df.index.name = "date"
    return df.astype(float)


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["date"], index_col="date")
    df.columns = [c.lower() for c in df.columns]
    return df[["open", "high", "low", "close", "volume"]].astype(float)


def sample(symbol: str, days: int = 400) -> pd.DataFrame:
    """Dữ liệu giả lập (random walk), cố định theo mã để kết quả lặp lại được."""
    rng = np.random.default_rng(zlib.crc32(symbol.upper().encode()))
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days, name="date")
    close = 30 * np.exp(np.cumsum(rng.normal(0.0005, 0.02, days)))
    open_ = close * (1 + rng.normal(0, 0.005, days))
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.015, days))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.015, days))
    vol = rng.lognormal(14, 0.4, days)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": vol}, index=idx)


def get(symbol: str, days: int = 500) -> tuple[pd.DataFrame, str]:
    """Trả về (dữ liệu, nguồn). Thử VNDirect trước, lỗi thì rơi về dữ liệu mẫu."""
    try:
        return fetch_vndirect(symbol, days), "VNDirect"
    except Exception:
        return sample(symbol), "mẫu (không lấy được dữ liệu thật)"
