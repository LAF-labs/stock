import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ADMIN_SESSION_COOKIE,
  adminCredentialsAreValid,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/adminAuth";
import { fetchAdminDashboardData, type AdminDashboardData, type AdminRefreshJobRow } from "@/lib/adminMetrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const isAuthed = verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!isAuthed) return <AdminLogin error={firstParam(params?.error) === "1"} />;

  const data = await fetchAdminDashboardData();
  return <AdminDashboard data={data} />;
}

async function loginAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  const password = String(formData.get("password") || "");
  if (!adminCredentialsAreValid(id, password)) redirect("/admin?error=1");

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 12,
  });
  redirect("/admin");
}

async function logoutAction() {
  "use server";

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", { path: "/admin", maxAge: 0 });
  redirect("/admin");
}

function AdminLogin({ error }: { error: boolean }) {
  return (
    <main className="admin-shell admin-login-shell">
      <AdminStyles />
      <form action={loginAction} className="admin-login-panel">
        <span>운영자 로그인</span>
        <h1>StockStalker Admin</h1>
        <label>
          ID
          <input name="id" type="text" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error ? <p role="alert">아이디 또는 비밀번호가 맞지 않습니다.</p> : null}
        <button type="submit">로그인</button>
      </form>
    </main>
  );
}

function AdminDashboard({ data }: { data: AdminDashboardData }) {
  return (
    <main className="admin-shell">
      <AdminStyles />
      <header className="admin-header">
        <div>
          <span>운영 대시보드</span>
          <h1>{data.dateLabel} 현황</h1>
        </div>
        <form action={logoutAction}>
          <button type="submit">로그아웃</button>
        </form>
      </header>

      {data.error ? <p className="admin-alert">{data.error}</p> : null}

      <section className="admin-metrics" aria-label="금일 요약">
        <article>
          <span>금일 방문자</span>
          <strong>{data.todayVisitors.toLocaleString("ko-KR")}</strong>
        </article>
        <article>
          <span>금일 페이지뷰</span>
          <strong>{data.todayViews.toLocaleString("ko-KR")}</strong>
        </article>
        <article>
          <span>대기 Job</span>
          <strong>{(data.jobsByStatus.queued || 0).toLocaleString("ko-KR")}</strong>
        </article>
        <article>
          <span>실행 Job</span>
          <strong>{(data.jobsByStatus.running || 0).toLocaleString("ko-KR")}</strong>
        </article>
      </section>

      <section className="admin-grid">
        <AdminPanel title="종목별 조회수">
          {data.stockViews.length ? (
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>조회수</th>
                  <th>방문자</th>
                  <th>최근 조회</th>
                </tr>
              </thead>
              <tbody>
                {data.stockViews.slice(0, 30).map((item) => (
                  <tr key={item.ticker}>
                    <td>{item.ticker}</td>
                    <td>{item.views.toLocaleString("ko-KR")}</td>
                    <td>{item.visitors.toLocaleString("ko-KR")}</td>
                    <td>{formatKoreanTime(item.lastViewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="admin-empty">오늘 종목 조회가 없습니다.</p>
          )}
        </AdminPanel>

        <AdminPanel title="서버 Job Queue">
          {data.jobs.length ? (
            <table>
              <thead>
                <tr>
                  <th>상태</th>
                  <th>작업</th>
                  <th>종목</th>
                  <th>시도</th>
                  <th>실행 예정</th>
                  <th>에러</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => <JobRow job={job} key={job.id} />)}
              </tbody>
            </table>
          ) : (
            <p className="admin-empty">표시할 Job이 없습니다.</p>
          )}
        </AdminPanel>
      </section>
    </main>
  );
}

function AdminPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="admin-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function JobRow({ job }: { job: AdminRefreshJobRow }) {
  return (
    <tr>
      <td>
        <span className={`admin-status admin-status-${job.status}`}>{job.status}</span>
      </td>
      <td>{job.kind}{job.view_mode ? ` · ${job.view_mode}` : ""}</td>
      <td>{job.market}:{job.symbol}</td>
      <td>{job.attempts}/{job.max_attempts}</td>
      <td>{formatKoreanTime(job.run_after)}</td>
      <td title={job.last_error || ""}>{job.last_error || "-"}</td>
    </tr>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatKoreanTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function AdminStyles() {
  return (
    <style>{`
      .admin-shell {
        min-height: 100vh;
        padding: 32px;
        background: #f6f8fb;
        color: #162033;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .admin-login-shell {
        display: grid;
        place-items: center;
      }
      .admin-login-panel,
      .admin-panel,
      .admin-metrics article {
        border: 1px solid #dbe3ee;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      }
      .admin-login-panel {
        width: min(420px, 100%);
        display: grid;
        gap: 16px;
        padding: 28px;
      }
      .admin-login-panel span,
      .admin-header span,
      .admin-metrics span {
        color: #61708a;
        font-size: 13px;
        font-weight: 700;
      }
      .admin-login-panel h1,
      .admin-header h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.15;
      }
      .admin-login-panel label {
        display: grid;
        gap: 7px;
        color: #3f4d63;
        font-size: 13px;
        font-weight: 700;
      }
      .admin-login-panel input {
        height: 44px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 0 12px;
        font: inherit;
      }
      .admin-login-panel p,
      .admin-alert {
        margin: 0;
        color: #be123c;
        font-size: 14px;
        font-weight: 700;
      }
      .admin-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 22px;
      }
      .admin-shell button {
        min-height: 40px;
        border: 0;
        border-radius: 6px;
        padding: 0 16px;
        background: #2563eb;
        color: #fff;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .admin-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .admin-metrics article {
        padding: 18px;
      }
      .admin-metrics strong {
        display: block;
        margin-top: 8px;
        font-size: 28px;
        line-height: 1;
      }
      .admin-grid {
        display: grid;
        gap: 16px;
      }
      .admin-panel {
        overflow: auto;
        padding: 18px;
      }
      .admin-panel h2 {
        margin: 0 0 14px;
        font-size: 18px;
      }
      .admin-panel table {
        width: 100%;
        border-collapse: collapse;
        min-width: 760px;
      }
      .admin-panel th,
      .admin-panel td {
        max-width: 340px;
        padding: 11px 10px;
        border-top: 1px solid #e5eaf2;
        text-align: left;
        font-size: 13px;
        vertical-align: top;
      }
      .admin-panel th {
        color: #61708a;
        font-size: 12px;
        text-transform: uppercase;
      }
      .admin-panel td:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .admin-status {
        display: inline-flex;
        border-radius: 999px;
        padding: 4px 8px;
        background: #eef2f7;
        color: #334155;
        font-weight: 800;
      }
      .admin-status-queued { background: #eff6ff; color: #1d4ed8; }
      .admin-status-running { background: #fffbeb; color: #a16207; }
      .admin-status-dead,
      .admin-status-failed { background: #fff1f2; color: #be123c; }
      .admin-status-succeeded { background: #ecfdf5; color: #047857; }
      .admin-empty {
        margin: 0;
        color: #61708a;
        font-weight: 700;
      }
      @media (max-width: 760px) {
        .admin-shell { padding: 18px; }
        .admin-header { align-items: flex-start; flex-direction: column; }
        .admin-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `}</style>
  );
}
