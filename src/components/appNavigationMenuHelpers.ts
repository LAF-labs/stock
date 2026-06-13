export type AppNavigationPage = "home" | "detail" | "technical" | "compare" | "marketCap";

export type GlobalNavigationId = "home" | "detail" | "compare" | "marketCap";

export type AppNavigationItem = {
  id?: GlobalNavigationId;
  label: string;
  href: string;
  shortLabel?: string;
  active?: boolean;
};

export type AppNavigationContext =
  | { page: "home" }
  | { page: "marketCap" }
  | { page: "detail"; ticker?: string; compareHref?: string }
  | { page: "technical"; ticker: string; detailHref: string; compareHref?: string }
  | { page: "compare"; originTicker?: string; detailHref?: string };

export type MobileNavigationEvent = "toggle" | "scroll" | "outside" | "noop";

export type MobileNavigationOpenState = {
  currentOpen: boolean;
  event: MobileNavigationEvent;
};

export type MobileContextActionVariant = "full" | "compact";

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

export function globalNavigationItemsForContext(context: AppNavigationContext): AppNavigationItem[] {
  const detailTarget = detailNavigationTarget(context);
  const items: AppNavigationItem[] = [
    {
      id: "home",
      label: "검색",
      href: "/",
      active: context.page === "home",
    },
  ];

  if (detailTarget) {
    items.push({
      id: "detail",
      label: "종목 상세",
      shortLabel: "상세",
      href: detailTarget.href,
      active: context.page === "detail",
    });
  }

  items.push(
    {
      id: "compare",
      label: "종목 비교",
      shortLabel: "비교",
      href: compareNavigationHref(context),
      active: context.page === "compare",
    },
    {
      id: "marketCap",
      label: "시가총액",
      shortLabel: "시총",
      href: "/market-cap",
      active: context.page === "marketCap",
    },
  );

  return items;
}

export function nextMobileNavigationOpen({ currentOpen, event }: MobileNavigationOpenState): boolean {
  if (event === "toggle") return !currentOpen;
  if (event === "scroll" || event === "outside") return false;
  return currentOpen;
}

export function mobileContextActionVariant(scrollY: number): MobileContextActionVariant {
  return scrollY >= 24 ? "compact" : "full";
}

function detailNavigationTarget(context: AppNavigationContext): { href: string } | undefined {
  if (context.page === "detail") return { href: detailHref(context.ticker) };
  if (context.page === "technical") return { href: context.detailHref };
  if (context.page === "compare" && (context.detailHref || context.originTicker)) {
    return { href: context.detailHref || detailHref(context.originTicker) };
  }
  return undefined;
}

function compareNavigationHref(context: AppNavigationContext): string {
  if (context.page === "detail") return context.compareHref || compareHref(context.ticker);
  if (context.page === "technical") return context.compareHref || compareHref(context.ticker);
  return "/compare";
}

function compareHref(ticker: string | undefined): string {
  if (!ticker) return "/compare";
  const params = new URLSearchParams({ tickers: ticker, origin: ticker });
  return `/compare?${params.toString()}`;
}

function detailHref(ticker: string | undefined): string {
  return ticker ? `/?ticker=${encodeURIComponent(ticker)}` : "/";
}
