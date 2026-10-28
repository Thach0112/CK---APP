"""Giao diện web demo. Chạy: streamlit run app.py"""
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from ckapp import data
from ckapp.signals import score, screen

st.set_page_config(page_title="CK TA", layout="wide")
st.title("App chứng khoán theo chỉ báo kỹ thuật")

tab_chart, tab_screen = st.tabs(["Biểu đồ 1 mã", "Lọc cổ phiếu"])

with tab_chart:
    sym = st.text_input("Mã cổ phiếu", "FPT").upper()
    df, src = data.get(sym)
    d = score(df)
    last = d.iloc[-1]
    st.caption(f"Nguồn dữ liệu: {src} · phiên gần nhất {d.index[-1].date()}")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Giá đóng cửa", f"{last.close:,.2f}")
    c2.metric("RSI(14)", f"{last.rsi14:.1f}")
    c3.metric("Điểm tín hiệu", int(last.score))
    c4.metric("Khuyến nghị", last.action)

    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, row_heights=[0.6, 0.2, 0.2], vertical_spacing=0.03)
    fig.add_trace(go.Candlestick(x=d.index, open=d.open, high=d.high, low=d.low, close=d.close, name=sym), 1, 1)
    for col in ("ma20", "ma50", "ma200", "bb_upper", "bb_lower"):
        fig.add_trace(go.Scatter(x=d.index, y=d[col], name=col, line=dict(width=1)), 1, 1)
    buys, sells = d[d.action == "MUA"], d[d.action == "BÁN"]
    fig.add_trace(go.Scatter(x=buys.index, y=buys.low * 0.98, mode="markers", name="Mua",
                             marker=dict(symbol="triangle-up", size=10, color="green")), 1, 1)
    fig.add_trace(go.Scatter(x=sells.index, y=sells.high * 1.02, mode="markers", name="Bán",
                             marker=dict(symbol="triangle-down", size=10, color="red")), 1, 1)
    fig.add_trace(go.Scatter(x=d.index, y=d.rsi14, name="RSI14"), 2, 1)
    fig.add_hline(y=70, line_dash="dot", row=2, col=1)
    fig.add_hline(y=30, line_dash="dot", row=2, col=1)
    fig.add_trace(go.Bar(x=d.index, y=d.macd_hist, name="MACD hist"), 3, 1)
    fig.add_trace(go.Scatter(x=d.index, y=d.macd, name="MACD"), 3, 1)
    fig.add_trace(go.Scatter(x=d.index, y=d.macd_signal, name="Signal"), 3, 1)
    fig.update_layout(height=750, xaxis_rangeslider_visible=False)
    st.plotly_chart(fig, use_container_width=True)

with tab_screen:
    syms = st.text_input("Danh sách mã (cách nhau bởi dấu phẩy)",
                         "FPT,VNM,HPG,VCB,MWG,SSI,TCB,MBB,VHM,GAS")
    if st.button("Lọc"):
        universe = {s.strip().upper(): data.get(s.strip())[0] for s in syms.split(",") if s.strip()}
        st.dataframe(screen(universe), use_container_width=True)
