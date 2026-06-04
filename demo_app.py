from __future__ import annotations

import argparse
import json
import webbrowser
from html import escape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Mapping
from urllib.parse import parse_qs, urlencode, urlparse


APP_TITLE = "SIA Stock Score UI Demo"
DEFAULT_TICKER = "ASTS"
PORT = 8891

ALIASES = {
    "asts": "ASTS",
    "rklb": "RKLB",
    "aapl": "AAPL",
    "apple": "AAPL",
    "애플": "AAPL",
    "삼성전자": "005930.KS",
    "삼전": "005930.KS",
    "samsung": "005930.KS",
    "테슬라": "TSLA",
    "tesla": "TSLA",
}

MOCK_STOCKS: Dict[str, Dict[str, Any]] = {
    "ASTS": {
        "symbol": "ASTS",
        "name": "AST SpaceMobile",
        "market": "미국, 나스닥",
        "currency": "USD",
        "price": "$121.27",
        "change": "▲ $1.57 (+1.31%)",
        "market_cap": "약 53조6,000억원",
        "volume": "3,591,582",
        "trade_value": "4억 USD",
        "score": 49.0,
        "grade": "보통",
        "summary": "UI 흐름 확인용 목업 결과입니다. 실제 산식과 실시간 데이터는 포함하지 않았습니다.",
        "components": [
            ("수익성", 46, "이익 지표 패널 예시"),
            ("성장성", 58, "매출 성장 카드 예시"),
            ("재무건전성", 44, "부채/현금성 지표 예시"),
            ("모멘텀", 52, "가격 흐름 카드 예시"),
            ("밸류에이션", 38, "가치 평가 카드 예시"),
        ],
        "metrics": [
            ("PER", "목업 32.1"),
            ("52주 수익", "+18.4%"),
            ("ATR14", "6.8%"),
            ("거래금", "4억 USD"),
        ],
        "patterns": [
            ("추세", "중립", "단기 반등은 있으나 장기 추세 확인이 필요하다는 예시 문구입니다."),
            ("거래량", "관심", "최근 거래량이 늘어난 상황을 보여주는 UI 예시입니다."),
        ],
        "chart": [
            ("06/01 22:30", 114.2, "1.2M"),
            ("06/01 23:00", 116.5, "1.8M"),
            ("06/01 23:30", 117.1, "2.1M"),
            ("06/02 00:00", 119.4, "2.7M"),
            ("06/02 00:30", 118.8, "2.9M"),
            ("06/02 01:00", 121.0, "3.2M"),
            ("06/02 01:30", 121.6, "3.5M"),
            ("06/02 02:00", 121.27, "3.6M"),
        ],
    },
    "RKLB": {
        "symbol": "RKLB",
        "name": "Rocket Lab",
        "market": "미국, 나스닥",
        "currency": "USD",
        "price": "$149.21",
        "change": "▲ $6.01 (+4.20%)",
        "market_cap": "약 124조원",
        "volume": "4,302,828",
        "trade_value": "6억 USD",
        "score": 55.8,
        "grade": "보통",
        "summary": "채팅 명령과 카드 UI가 어떻게 이어지는지 보여주는 데모 데이터입니다.",
        "components": [
            ("수익성", 52, "마진 지표 카드 예시"),
            ("성장성", 61, "성장성 카드 예시"),
            ("재무건전성", 50, "재무 안정성 카드 예시"),
            ("모멘텀", 66, "추세 점수 카드 예시"),
            ("밸류에이션", 40, "밸류에이션 카드 예시"),
        ],
        "metrics": [("PER", "목업 41.7"), ("52주 수익", "+42.1%"), ("ATR14", "7.4%"), ("거래금", "6억 USD")],
        "patterns": [("추세", "상승", "고점 갱신 후 눌림을 확인하는 차트 해석 예시입니다."), ("거래량", "강함", "상승 구간에서 거래량이 붙는 형태의 예시입니다.")],
        "chart": [
            ("06/01 22:30", 141.0, "1.1M"),
            ("06/01 23:00", 143.2, "1.5M"),
            ("06/01 23:30", 145.5, "2.0M"),
            ("06/02 00:00", 146.0, "2.2M"),
            ("06/02 00:30", 148.4, "3.0M"),
            ("06/02 01:00", 147.9, "3.2M"),
            ("06/02 01:30", 149.7, "4.0M"),
            ("06/02 02:00", 149.21, "4.3M"),
        ],
    },
    "AAPL": {
        "symbol": "AAPL",
        "name": "Apple",
        "market": "미국, 나스닥",
        "currency": "USD",
        "price": "$203.42",
        "change": "▼ $0.84 (-0.41%)",
        "market_cap": "약 4,430조원",
        "volume": "42,801,220",
        "trade_value": "87억 USD",
        "score": 66.4,
        "grade": "양호",
        "summary": "대형주 예시 화면입니다. 숫자는 UI 시연용으로 고정되어 있습니다.",
        "components": [
            ("수익성", 78, "수익성 카드 예시"),
            ("성장성", 54, "성장성 카드 예시"),
            ("재무건전성", 72, "재무 카드 예시"),
            ("모멘텀", 49, "모멘텀 카드 예시"),
            ("밸류에이션", 55, "밸류 카드 예시"),
        ],
        "metrics": [("PER", "목업 29.4"), ("52주 수익", "+9.8%"), ("ATR14", "2.1%"), ("거래금", "87억 USD")],
        "patterns": [("추세", "중립", "박스권 안에서 방향을 탐색하는 예시입니다."), ("변동성", "낮음", "대형주답게 변동성이 낮은 케이스를 보여줍니다.")],
        "chart": [
            ("06/01 22:30", 204.1, "5.1M"),
            ("06/01 23:00", 203.8, "8.4M"),
            ("06/01 23:30", 203.6, "11.0M"),
            ("06/02 00:00", 204.4, "16.2M"),
            ("06/02 00:30", 203.9, "20.5M"),
            ("06/02 01:00", 203.2, "25.8M"),
            ("06/02 01:30", 203.7, "34.0M"),
            ("06/02 02:00", 203.42, "42.8M"),
        ],
    },
    "005930.KS": {
        "symbol": "005930.KS",
        "name": "Samsung Electronics",
        "market": "한국, 코스피",
        "currency": "KRW",
        "price": "₩307,000",
        "change": "▲ ₩8,000 (+2.68%)",
        "market_cap": "1,874조원",
        "volume": "33,916,688",
        "trade_value": "10조4,000억원",
        "score": 90.5,
        "grade": "우수",
        "summary": "한국 원화 표기와 국내 종목 입력 흐름을 확인하는 데모 데이터입니다.",
        "components": [
            ("수익성", 92, "수익성 카드 예시"),
            ("성장성", 88, "성장 카드 예시"),
            ("재무건전성", 94, "재무 카드 예시"),
            ("모멘텀", 87, "모멘텀 카드 예시"),
            ("밸류에이션", 91, "밸류 카드 예시"),
        ],
        "metrics": [("PER", "목업 18.2"), ("52주 수익", "+33.0%"), ("ATR14", "3.4%"), ("거래금", "10조4,000억원")],
        "patterns": [("추세", "상승", "국내 종목도 같은 UI로 해석 목록을 보여주는 예시입니다."), ("가격대", "돌파", "전고점 돌파 상황을 표현하는 목업 문구입니다.")],
        "chart": [
            ("06/01 09:00", 298000, "2.1M"),
            ("06/01 10:00", 300500, "5.0M"),
            ("06/01 11:00", 303000, "8.8M"),
            ("06/01 12:00", 302000, "12.0M"),
            ("06/01 13:00", 305000, "20.4M"),
            ("06/01 14:00", 306500, "27.1M"),
            ("06/01 15:00", 307500, "32.8M"),
            ("06/01 15:30", 307000, "33.9M"),
        ],
    },
    "TSLA": {
        "symbol": "TSLA",
        "name": "Tesla",
        "market": "미국, 나스닥",
        "currency": "USD",
        "price": "$186.20",
        "change": "▲ $3.10 (+1.69%)",
        "market_cap": "약 820조원",
        "volume": "72,104,111",
        "trade_value": "134억 USD",
        "score": 51.2,
        "grade": "보통",
        "summary": "변동성이 큰 종목의 UI 표현을 보여주는 데모 데이터입니다.",
        "components": [
            ("수익성", 44, "수익성 카드 예시"),
            ("성장성", 63, "성장 카드 예시"),
            ("재무건전성", 57, "재무 카드 예시"),
            ("모멘텀", 60, "모멘텀 카드 예시"),
            ("밸류에이션", 32, "밸류 카드 예시"),
        ],
        "metrics": [("PER", "목업 64.8"), ("52주 수익", "-4.2%"), ("ATR14", "5.9%"), ("거래금", "134억 USD")],
        "patterns": [("추세", "혼조", "큰 변동 이후 방향 확인이 필요하다는 예시입니다."), ("변동성", "높음", "가격 흔들림이 큰 화면 예시입니다.")],
        "chart": [
            ("06/01 22:30", 181.0, "9.2M"),
            ("06/01 23:00", 184.1, "16.0M"),
            ("06/01 23:30", 183.7, "24.4M"),
            ("06/02 00:00", 185.5, "31.8M"),
            ("06/02 00:30", 184.9, "41.0M"),
            ("06/02 01:00", 186.4, "53.1M"),
            ("06/02 01:30", 187.2, "65.4M"),
            ("06/02 02:00", 186.2, "72.1M"),
        ],
    },
}


def normalize_ticker(value: str) -> str:
    token = str(value or "").strip().replace(" ", "")
    if token.startswith("!"):
        token = token[1:]
    alias = ALIASES.get(token.lower()) or ALIASES.get(token)
    if alias:
        return alias
    if token.isdigit() and len(token) == 6:
        return f"{token}.KS"
    return token.upper() or DEFAULT_TICKER


def stock_for(value: str) -> Dict[str, Any]:
    symbol = normalize_ticker(value)
    return dict(MOCK_STOCKS.get(symbol) or MOCK_STOCKS[DEFAULT_TICKER])


def request_base_url(handler: BaseHTTPRequestHandler) -> str:
    host = handler.headers.get("Host") or f"127.0.0.1:{PORT}"
    return f"http://{host}".rstrip("/")


def render_kakao_message(stock: Mapping[str, Any], share_url: str) -> str:
    return "\n".join(
        [
            f"{stock['symbol']}, {stock['name']} ({stock['market']})",
            f"시가총액: {stock['market_cap']}",
            f"데모 점수: {stock['score']:.1f}/100",
            "",
            "정규장(목업)",
            f"{stock['price']} {stock['change']}",
            f"거래량: {stock['volume']}",
            f"거래금: {stock['trade_value']}",
            "",
            share_url,
        ]
    )


def build_kakao_skill(payload: Mapping[str, Any], base_url: str) -> Dict[str, Any]:
    text = ""
    action = payload.get("action") if isinstance(payload.get("action"), Mapping) else {}
    params = action.get("params") if isinstance(action.get("params"), Mapping) else {}
    for key in ("ticker", "symbol", "stock", "종목", "utterance"):
        if params.get(key):
            text = str(params[key])
            break
    if not text:
        user_request = payload.get("userRequest") if isinstance(payload.get("userRequest"), Mapping) else {}
        text = str(user_request.get("utterance") or DEFAULT_TICKER)
    stock = stock_for(text)
    share_url = f"{base_url}/?{urlencode({'ticker': stock['symbol']})}"
    return {
        "version": "2.0",
        "template": {
            "outputs": [{"simpleText": {"text": render_kakao_message(stock, share_url)}}],
            "quickReplies": [
                {"label": "ASTS", "action": "message", "messageText": "!asts"},
                {"label": "삼성전자", "action": "message", "messageText": "!삼성전자"},
                {"label": "RKLB", "action": "message", "messageText": "!rklb"},
            ],
        },
        "data": {"ok": True, "symbol": stock["symbol"], "mode": "ui-demo"},
    }


def render_page(ticker: str) -> str:
    stock = stock_for(ticker)
    examples = "".join(
        f'<a href="/?ticker={escape(symbol)}">{escape(symbol)}</a>'
        for symbol in ("ASTS", "RKLB", "AAPL", "005930.KS", "TSLA")
    )
    cards = "".join(
        f"""
        <article class="card">
          <div><span>{escape(label)}</span><b>{score}</b></div>
          <p>{escape(text)}</p>
        </article>
        """
        for label, score, text in stock["components"]
    )
    metrics = "".join(f"<li><span>{escape(label)}</span><b>{escape(value)}</b></li>" for label, value in stock["metrics"])
    patterns = "".join(
        f"<li><strong>{escape(name)}</strong><b>{escape(status)}</b><p>{escape(text)}</p></li>"
        for name, status, text in stock["patterns"]
    )
    chart_json = json.dumps(stock["chart"], ensure_ascii=False)
    score = float(stock["score"])
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{APP_TITLE}</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg:#0f172a; --panel:#152033; --line:#263650; --text:#eef4ff;
      --muted:#9eb0cc; --accent:#8b5cf6; --pink:#fb7185; --cyan:#38bdf8;
    }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font-family:Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }}
    a {{ color:inherit; text-decoration:none; }}
    .shell {{ width:min(1420px, 100%); margin:0 auto; padding:18px; }}
    .toolbar {{ display:grid; grid-template-columns:auto minmax(180px,1fr) auto; gap:10px; align-items:center; padding:14px; border:1px solid var(--line); background:#101a2c; }}
    .toolbar input {{ width:100%; padding:13px 14px; border:1px solid #34435f; background:#0b1220; color:var(--text); font-size:16px; }}
    .toolbar button {{ border:0; padding:13px 18px; background:var(--accent); color:white; font-weight:800; cursor:pointer; }}
    .examples {{ grid-column:1 / -1; display:flex; gap:8px; flex-wrap:wrap; color:var(--muted); font-size:13px; }}
    .examples a {{ padding:8px 10px; background:#1d2a3f; font-weight:800; }}
    .hero {{ display:grid; grid-template-columns:1.2fr .8fr; gap:14px; margin-top:14px; }}
    .panel, .card {{ border:1px solid var(--line); background:var(--panel); }}
    .score-panel {{ display:flex; gap:28px; align-items:center; padding:28px; min-height:260px; }}
    .donut {{ width:164px; aspect-ratio:1; border-radius:50%; display:grid; place-items:center; background:conic-gradient(var(--accent) calc(var(--score)*1%), #263650 0); }}
    .donut > div {{ width:118px; aspect-ratio:1; border-radius:50%; background:#111b2e; display:grid; place-items:center; text-align:center; }}
    .donut strong {{ display:block; font-size:44px; }}
    .badge {{ display:inline-block; padding:7px 10px; background:#2a194d; color:#ff6b8a; font-weight:900; margin-bottom:8px; }}
    h1 {{ margin:0; font-size:34px; }}
    .sub, .meta, p {{ color:var(--muted); line-height:1.55; }}
    .actions {{ display:flex; flex-wrap:wrap; gap:9px; margin-top:18px; }}
    .actions a {{ padding:10px 12px; background:#213049; font-weight:800; font-size:14px; }}
    .chart-panel {{ padding:20px; min-height:260px; }}
    .chart-title {{ display:flex; justify-content:space-between; gap:10px; color:var(--muted); font-weight:800; margin-bottom:12px; }}
    #chart {{ width:100%; height:220px; display:block; }}
    #tooltip {{ min-height:24px; color:var(--cyan); font-weight:800; font-size:14px; }}
    .grid {{ display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; margin-top:12px; }}
    .card {{ padding:16px; min-height:130px; }}
    .card div {{ display:flex; justify-content:space-between; align-items:center; }}
    .card span {{ font-weight:900; }}
    .card b {{ color:var(--pink); font-size:28px; }}
    .bottom {{ display:grid; grid-template-columns:.75fr 1.25fr; gap:14px; margin-top:14px; }}
    .panel h2 {{ margin:0 0 14px; font-size:18px; }}
    .metrics, .patterns {{ padding:20px; }}
    .metrics ul, .patterns ul {{ list-style:none; margin:0; padding:0; }}
    .metrics li {{ display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--line); }}
    .patterns li {{ padding:12px 0; border-bottom:1px solid var(--line); }}
    .patterns li strong {{ display:inline-block; width:90px; }}
    .patterns li b {{ color:var(--pink); }}
    .patterns p {{ margin:6px 0 0; }}
    @media (max-width: 820px) {{
      .shell {{ padding:10px; }}
      .toolbar, .hero, .bottom {{ grid-template-columns:1fr; }}
      .score-panel {{ align-items:flex-start; flex-direction:column; padding:22px; }}
      .grid {{ grid-template-columns:1fr; }}
      h1 {{ font-size:28px; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <form class="toolbar" method="get" action="/">
      <label for="ticker">티커</label>
      <input id="ticker" name="ticker" value="{escape(stock['symbol'])}" autocomplete="off">
      <button type="submit">보기</button>
      <div class="examples"><span>예시:</span>{examples}</div>
    </form>
    <section class="hero">
      <article class="panel score-panel">
        <div class="donut" style="--score:{score:.1f}"><div><strong>{score:.0f}</strong><span>/100</span></div></div>
        <div>
          <span class="badge">{escape(stock['grade'])}</span>
          <h1>{escape(stock['symbol'])}</h1>
          <p class="sub">{escape(stock['name'])} · {escape(stock['market'])}</p>
          <p>{escape(stock['summary'])}</p>
          <p class="meta">가격 {escape(stock['price'])} · {escape(stock['change'])} · 시가총액 {escape(stock['market_cap'])}</p>
          <div class="actions">
            <a href="/api/score?{urlencode({'ticker': stock['symbol']})}">API 보기</a>
            <a href="/api/kakao-skill-test?{urlencode({'text': '!' + stock['symbol']})}">카카오 응답</a>
          </div>
        </div>
      </article>
      <article class="panel chart-panel">
        <div class="chart-title"><span>목업 장중 차트</span><span>{escape(stock['price'])}</span></div>
        <svg id="chart" viewBox="0 0 720 220" role="img" aria-label="mock chart"></svg>
        <div id="tooltip">차트에 마우스를 올리면 날짜, 가격, 거래량이 표시됩니다.</div>
      </article>
    </section>
    <section class="grid">{cards}</section>
    <section class="bottom">
      <article class="panel metrics"><h2>기본 지표</h2><ul>{metrics}</ul></article>
      <article class="panel patterns"><h2>차트 해석 목록</h2><ul>{patterns}</ul></article>
    </section>
  </main>
  <script>
    const chartData = {chart_json};
    const svg = document.getElementById("chart");
    const tooltip = document.getElementById("tooltip");
    const w = 720, h = 220, pad = 28;
    const values = chartData.map(row => Number(row[1]));
    const min = Math.min(...values), max = Math.max(...values);
    const x = i => pad + (w - pad * 2) * (i / Math.max(1, chartData.length - 1));
    const y = v => h - pad - (h - pad * 2) * ((v - min) / Math.max(1, max - min));
    svg.innerHTML = `
      <rect x="0" y="0" width="${{w}}" height="${{h}}" fill="#101a2c"></rect>
      ${{[0,1,2,3].map(i => `<line x1="${{pad}}" x2="${{w-pad}}" y1="${{pad+i*42}}" y2="${{pad+i*42}}" stroke="#263650"/>`).join("")}}
      <polyline points="${{chartData.map((row, i) => `${{x(i)}},${{y(row[1])}}`).join(" ")}}" fill="none" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round"/>
      ${{chartData.map((row, i) => `<circle cx="${{x(i)}}" cy="${{y(row[1])}}" r="4" fill="#38bdf8" data-i="${{i}}"></circle>`).join("")}}
    `;
    svg.addEventListener("mousemove", event => {{
      const rect = svg.getBoundingClientRect();
      const mx = ((event.clientX - rect.left) / rect.width) * w;
      let nearest = 0;
      chartData.forEach((row, i) => {{ if (Math.abs(x(i) - mx) < Math.abs(x(nearest) - mx)) nearest = i; }});
      const row = chartData[nearest];
      tooltip.textContent = `${{row[0]}} · 가격 ${{row[1].toLocaleString()}} · 거래량 ${{row[2]}}`;
    }});
  </script>
</body>
</html>"""


class DemoHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        ticker = query.get("ticker", [DEFAULT_TICKER])[0]
        if parsed.path in {"/", "/index.html"}:
            self._send(HTTPStatus.OK, render_page(ticker), "text/html; charset=utf-8")
            return
        if parsed.path == "/api/score":
            self._json(HTTPStatus.OK, stock_for(ticker))
            return
        if parsed.path == "/api/kakao-skill-test":
            text = query.get("text", ["!asts"])[0]
            payload = {"userRequest": {"utterance": text}, "action": {"params": {}}}
            self._json(HTTPStatus.OK, build_kakao_skill(payload, request_base_url(self)))
            return
        if parsed.path == "/healthz":
            self._json(HTTPStatus.OK, {"status": "ok", "mode": "ui-demo"})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/kakao-skill":
            self.send_error(405, "demo is read-only")
            return
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(min(length, 64_000)) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            payload = {}
        self._json(HTTPStatus.OK, build_kakao_skill(payload if isinstance(payload, dict) else {}, request_base_url(self)))

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _json(self, status: HTTPStatus, payload: Mapping[str, Any]) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False, indent=2), "application/json; charset=utf-8")

    def _send(self, status: HTTPStatus, body: str, content_type: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SIA stock score UI demo.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), DemoHandler)
    url = f"http://{args.host}:{args.port}/?ticker={DEFAULT_TICKER}"
    print(f"{APP_TITLE} serving at {url}")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
