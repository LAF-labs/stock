"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadStockFilings, type StockFilingsState } from "@/components/useStockFilings";
import type { SecFilingListItem } from "@/lib/secFilings";

const PAGE_SIZE = 10;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export function DisclosureFeed({ ticker, state }: { ticker: string | undefined; state: StockFilingsState }) {
  const [open, setOpen] = useState(false);
  const items = state.status === "success" ? state.items : [];
  const total = state.status === "success" ? state.total : 0;

  return (
    <section className="static-card disclosure-card">
      <header>
        <span>빠르게 최신 공시를 확인하세요.</span>
        <strong>최근 공시</strong>
      </header>
      <div className="accordion-body">
        {state.status === "loading" ? (
          <p className="static-empty">공시를 불러오는 중이에요.</p>
        ) : items.length ? (
          <>
            <DisclosureList items={items.slice(0, 3)} />
            <button type="button" className="disclosure-more-button" onClick={() => setOpen(true)}>
              공시 더 보기
            </button>
          </>
        ) : (
          <p className="static-empty">표시할 최근 SEC 공시가 없어요.</p>
        )}
      </div>
      {open && ticker ? (
        <DisclosureModal ticker={ticker} initialItems={items} initialTotal={total} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}

export function hasRecentSecFiling(state: StockFilingsState): boolean {
  return state.status === "success" && state.items.some((item) => filingIsRecent(item));
}

function DisclosureModal({
  ticker,
  initialItems,
  initialTotal,
  onClose,
}: {
  ticker: string;
  initialItems: SecFilingListItem[];
  initialTotal: number;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    void loadStockFilings(ticker, fetch, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, signal: controller.signal }).then((result) => {
      if (result.ok) {
        setItems(result.items);
        setTotal(result.total);
        setStatus("idle");
        return;
      }
      if (result.error !== "aborted") setStatus("error");
    });
    return () => controller.abort();
  }, [page, ticker]);

  return (
    <div className="disclosure-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="disclosure-modal"
        role="dialog"
        aria-modal="true"
        aria-label="SEC 공시 더 보기"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>SEC 공시</span>
            <strong>최근 공시 더 보기</strong>
          </div>
          <button type="button" className="disclosure-icon-button" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="disclosure-modal-body">
          {status === "loading" ? <p className="static-empty">불러오는 중이에요.</p> : null}
          {status === "error" ? <p className="static-empty">공시를 불러오지 못했어요.</p> : null}
          {items.length ? <DisclosureList items={items} /> : status === "idle" ? <p className="static-empty">표시할 공시가 없어요.</p> : null}
        </div>
        <footer>
          <button type="button" className="disclosure-page-button" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            <ChevronLeft size={16} />
            이전
          </button>
          <span>{page + 1} / {pages}</span>
          <button type="button" className="disclosure-page-button" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>
            다음
            <ChevronRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}

function DisclosureList({ items }: { items: SecFilingListItem[] }) {
  return (
    <div className="disclosure-list">
      {items.map((item) => {
        const href = safeExternalUrl(item.sourceUrl);
        const content = (
          <>
            <span className="disclosure-meta">
              {filingIsRecent(item) ? <i aria-label="최근 1주일 내 새 공시" /> : null}
              {formatFilingDate(item.filedAt)} · {item.formType}
              {href ? <ExternalLink size={13} aria-hidden="true" /> : null}
            </span>
            <strong>{item.summaryKo}</strong>
          </>
        );
        return href ? (
          <a className="disclosure-list-item" href={href} target="_blank" rel="noopener noreferrer" key={item.accessionNumber}>
            {content}
          </a>
        ) : (
          <div className="disclosure-list-item" key={item.accessionNumber}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function filingIsRecent(item: SecFilingListItem): boolean {
  const filedMs = Date.parse(item.filedAt);
  return Number.isFinite(filedMs) && Date.now() - filedMs <= RECENT_MS;
}

function formatFilingDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10) || "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith("sec.gov") ? value : undefined;
  } catch {
    return undefined;
  }
}
