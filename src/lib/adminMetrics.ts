import { createHash, randomUUID } from "node:crypto";
import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

export const STOCK_VISITOR_COOKIE = "stock_visitor_id";

export type AdminPageViewRow = {
  visitor_key: string;
  ticker: string | null;
  occurred_at: string;
};

export type AdminRefreshJobRow = {
  id: string;
  kind: string;
  market: string;
  symbol: string;
  view_mode: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminStockViewSummary = {
  ticker: string;
  views: number;
  visitors: number;
  lastViewedAt: string;
};

export type AdminDashboardData = {
  dateLabel: string;
  todayVisitors: number;
  todayViews: number;
  stockViews: AdminStockViewSummary[];
  jobs: AdminRefreshJobRow[];
  jobsByStatus: Record<string, number>;
  error?: string;
};

export async function fetchAdminDashboardData(now = new Date()): Promise<AdminDashboardData> {
  const config = supabaseAdminConfig();
  const window = adminTodayWindow(now);
  if (!config) return emptyAdminDashboardData(window.dateLabel, "Supabase service role is not configured.");

  try {
    const [viewsResponse, jobsResponse] = await Promise.all([
      fetchWithTimeout(
        `${config.url}/rest/v1/admin_page_views?select=visitor_key,ticker,occurred_at&occurred_at=gte.${encodeURIComponent(window.startIso)}&occurred_at=lt.${encodeURIComponent(window.endIso)}&order=occurred_at.desc&limit=5000`,
        { headers: supabaseHeaders(config.key) },
        2_500
      ),
      fetchWithTimeout(
        `${config.url}/rest/v1/stock_refresh_jobs?select=id,kind,market,symbol,view_mode,status,priority,attempts,max_attempts,run_after,locked_by,locked_at,last_error,created_at,updated_at&order=created_at.desc&limit=100`,
        { headers: supabaseHeaders(config.key) },
        2_500
      ),
    ]);
    if (!viewsResponse.ok || !jobsResponse.ok) {
      return emptyAdminDashboardData(window.dateLabel, "운영 데이터를 불러오지 못했습니다.");
    }

    return {
      dateLabel: window.dateLabel,
      ...summarizeAdminMetrics(await viewsResponse.json(), await jobsResponse.json()),
    };
  } catch {
    return emptyAdminDashboardData(window.dateLabel, "운영 데이터를 불러오지 못했습니다.");
  }
}

export async function recordAdminPageView(input: {
  visitorId: string | undefined;
  ticker?: string;
  path: string;
  userAgent?: string;
}): Promise<{ visitorId: string; stored: boolean }> {
  const visitorId = input.visitorId || randomUUID();
  const config = supabaseAdminConfig();
  if (!config) return { visitorId, stored: false };

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/admin_page_views`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          visitor_key: visitorKey(visitorId),
          ticker: input.ticker || null,
          path: input.path.slice(0, 240),
          user_agent: input.userAgent?.slice(0, 240) || null,
        }),
      },
      1_200
    );
    return { visitorId, stored: response.ok };
  } catch {
    return { visitorId, stored: false };
  }
}

export function summarizeAdminMetrics(views: AdminPageViewRow[], jobs: AdminRefreshJobRow[]) {
  const visitors = new Set<string>();
  const stockBuckets = new Map<string, { views: number; visitors: Set<string>; lastViewedAt: string }>();
  const jobsByStatus: Record<string, number> = {};

  for (const view of views) {
    visitors.add(view.visitor_key);
    if (!view.ticker) continue;
    const bucket = stockBuckets.get(view.ticker) || { views: 0, visitors: new Set<string>(), lastViewedAt: view.occurred_at };
    bucket.views += 1;
    bucket.visitors.add(view.visitor_key);
    if (view.occurred_at > bucket.lastViewedAt) bucket.lastViewedAt = view.occurred_at;
    stockBuckets.set(view.ticker, bucket);
  }

  for (const job of jobs) {
    jobsByStatus[job.status] = (jobsByStatus[job.status] || 0) + 1;
  }

  return {
    todayVisitors: visitors.size,
    todayViews: views.length,
    stockViews: Array.from(stockBuckets, ([ticker, bucket]) => ({
      ticker,
      views: bucket.views,
      visitors: bucket.visitors.size,
      lastViewedAt: bucket.lastViewedAt,
    })).sort((a, b) => b.views - a.views || b.lastViewedAt.localeCompare(a.lastViewedAt)),
    jobs,
    jobsByStatus,
  };
}

export function adminTodayWindow(now = new Date()) {
  const dateLabel = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    dateLabel,
    startIso: new Date(`${dateLabel}T00:00:00+09:00`).toISOString(),
    endIso: new Date(`${dateLabel}T24:00:00+09:00`).toISOString(),
  };
}

function emptyAdminDashboardData(dateLabel: string, error: string): AdminDashboardData {
  return {
    dateLabel,
    todayVisitors: 0,
    todayViews: 0,
    stockViews: [],
    jobs: [],
    jobsByStatus: {},
    error,
  };
}

function visitorKey(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex");
}
