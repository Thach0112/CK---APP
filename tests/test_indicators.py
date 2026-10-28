import numpy as np
import pandas as pd

from ckapp import data, indicators as ta
from ckapp.signals import score, screen


def test_sma_ema_basic():
    s = pd.Series(np.arange(1, 11, dtype=float))
    assert ta.sma(s, 3).iloc[-1] == 9.0
    assert abs(ta.ema(pd.Series([5.0] * 30), 10).iloc[-1] - 5.0) < 1e-9


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1, 50, dtype=float))
    assert ta.rsi(up).iloc[-1] == 100.0
    r = ta.rsi(data.sample("FPT").close).dropna()
    assert r.between(0, 100).all()


def test_bollinger_order():
    b = ta.bollinger(data.sample("VNM").close).dropna()
    assert (b.bb_lower <= b.bb_mid).all() and (b.bb_mid <= b.bb_upper).all()


def test_score_and_screen():
    d = score(data.sample("HPG"))
    assert set(d.action.unique()) <= {"MUA", "BÁN", "THEO DÕI"}
    res = screen({s: data.sample(s) for s in ["FPT", "VNM", "HPG"]})
    assert len(res) == 3 and res.score.is_monotonic_decreasing


def test_sample_deterministic():
    assert data.sample("FPT").close.equals(data.sample("FPT").close)
