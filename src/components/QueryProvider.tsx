"use client";

import { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";
import { useState, type ReactNode } from "react";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";

export const STOCK_QUERY_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const STOCK_QUERY_PERSIST_KEY = "stock-query-cache-v5";
export const STOCK_QUERY_PERSIST_THROTTLE_MS = 1_000;

type RetryableStockError = {
  status?: number;
  code?: string;
  error?: string;
  state?: string;
};

type PersistableStockQuery = {
  queryKey: readonly unknown[];
  state: {
    status: string;
    data?: unknown;
  };
};

const NON_RETRYABLE_STOCK_STATES = new Set([
  "partial",
  "pending",
  "partial_stock_snapshot",
  "snapshot_pending",
  "snapshot_unavailable",
  "technical_unsupported_product",
  "refresh_cooldown",
  "missing_ticker",
  "invalid_ticker",
]);

export function stockQueryRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const retryableError = error && typeof error === "object" ? (error as RetryableStockError) : undefined;
  const state = retryableError?.state || retryableError?.code || retryableError?.error;
  if (state && NON_RETRYABLE_STOCK_STATES.has(state)) return false;
  const status = retryableError?.status;
  if (typeof status === "number") return status >= 500;
  return true;
}

export function createStockQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: stockQueryRetry,
      },
    },
  });
}

export function shouldPersistStockQuery(query: PersistableStockQuery): boolean {
  if (query.state.status !== "success") return false;
  if (query.queryKey[0] !== "stock") return false;
  const result = query.state.data && typeof query.state.data === "object" ? (query.state.data as { state?: unknown }) : undefined;
  if (result?.state !== "ready") return false;

  const feature = query.queryKey[1];
  if (feature === "display") return displayPayloadIsPersistable(query.state.data);
  if (feature === "quote" || feature === "symbols" || feature === "judgment") return true;
  if (feature !== "score" || query.queryKey[2] !== "detail") return false;
  const scoreResult = query.state.data && typeof query.state.data === "object" ? query.state.data as { data?: unknown; payload?: unknown } : undefined;
  return !stockScorePayloadNeedsEnrichment(scoreResult?.data) && !stockScorePayloadNeedsEnrichment(scoreResult?.payload);
}

function displayPayloadIsPersistable(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const result = data as { state?: unknown; data?: unknown };
  if (result.state !== "ready") return false;
  const payload = result.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown> & { ok?: unknown; identity?: unknown; completion?: unknown; refresh?: unknown };
  if (record.ok !== true || !record.identity) return false;

  const active = displayPayloadHasActiveRecovery(record);
  if (!active) return true;
  return displayPayloadHasUsefulPart(record);
}

function displayPayloadHasActiveRecovery(record: { completion?: unknown; refresh?: unknown }): boolean {
  const refresh = record.refresh && typeof record.refresh === "object" && !Array.isArray(record.refresh) ? record.refresh as { active?: unknown; recoveringParts?: unknown } : undefined;
  if (refresh?.active === true) return true;
  if (arrayHasItems(refresh?.recoveringParts)) return true;

  const completion = record.completion && typeof record.completion === "object" && !Array.isArray(record.completion) ? record.completion as { recoveringParts?: unknown } : undefined;
  return arrayHasItems(completion?.recoveringParts);
}

function displayPayloadHasUsefulPart(record: Record<string, unknown>): boolean {
  const completion = record.completion && typeof record.completion === "object" && !Array.isArray(record.completion)
    ? record.completion as { presentParts?: unknown }
    : undefined;
  const presentParts = Array.isArray(completion?.presentParts) ? completion.presentParts : [];
  return ["price", "chart", "score", "technical"].some((part) => record[part] || presentParts.includes(part));
}

function arrayHasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function createStockQueryPersister() {
  return createAsyncStoragePersister({
    key: STOCK_QUERY_PERSIST_KEY,
    throttleTime: STOCK_QUERY_PERSIST_THROTTLE_MS,
    storage: {
      getItem: async (key) => (await get<string>(key)) ?? null,
      setItem: async (key, value) => {
        await set(key, value);
      },
      removeItem: async (key) => {
        await del(key);
      },
    },
  });
}

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createStockQueryClient);
  const [persister] = useState(createStockQueryPersister);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        maxAge: STOCK_QUERY_CACHE_MAX_AGE_MS,
        persister,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistStockQuery,
        },
      }}
    >
      {children}
      {process.env.NODE_ENV !== "production" ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </PersistQueryClientProvider>
  );
}
