export type AppNavigationPage = "home" | "detail" | "technical" | "compare" | "marketCap";

export type AppNavigationItem = {
  label: string;
  href: string;
};

export type AppNavigationContext =
  | { page: "home" }
  | { page: "marketCap" }
  | { page: "detail"; ticker?: string; compareHref?: string }
  | { page: "technical"; ticker: string; detailHref: string; compareHref?: string }
  | { page: "compare"; originTicker?: string; detailHref?: string };

export function navigationItemsForContext(context: AppNavigationContext): AppNavigationItem[] {
  if (context.page === "home") {
    return [
      { label: "종목 비교", href: "/compare" },
      { label: "시가총액 대시보드", href: "/market-cap" },
    ];
  }

  if (context.page === "marketCap") {
    return [
      { label: "종목 비교", href: "/compare" },
      { label: "메인으로 돌아가기", href: "/" },
    ];
  }

  if (context.page === "detail") {
    return [
      { label: "종목 비교", href: context.compareHref || compareHref(context.ticker) },
      { label: "시가총액 대시보드", href: "/market-cap" },
      { label: "메인으로 돌아가기", href: "/" },
    ];
  }

  if (context.page === "technical") {
    return [
      { label: "종목 비교", href: context.compareHref || compareHref(context.ticker) },
      { label: "종목 상세로 돌아가기", href: context.detailHref },
      { label: "메인으로 돌아가기", href: "/" },
      { label: "시가총액 대시보드", href: "/market-cap" },
    ];
  }

  return [
    { label: "시가총액 대시보드", href: "/market-cap" },
    { label: "종목 상세로 돌아가기", href: context.detailHref || detailHref(context.originTicker) },
    { label: "메인으로 돌아가기", href: "/" },
  ];
}

function compareHref(ticker: string | undefined): string {
  if (!ticker) return "/compare";
  const params = new URLSearchParams({ tickers: ticker, origin: ticker });
  return `/compare?${params.toString()}`;
}

function detailHref(ticker: string | undefined): string {
  return ticker ? `/?ticker=${encodeURIComponent(ticker)}` : "/";
}
