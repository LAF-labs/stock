"use client";

import { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";
import { useState, type ReactNode } from "react";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";

export const STOCK_QUERY_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const STOCK_QUERY_PERSIST_KEY = "stock-query-cache-v4";
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
  if (feature === "quote" || feature === "symbols" || feature === "judgment") return true;
  if (feature !== "score" || query.queryKey[2] !== "detail") return false;
  const scoreResult = query.state.data && typeof query.state.data === "object" ? query.state.data as { data?: unknown; payload?: unknown } : undefined;
  return !stockScorePayloadNeedsEnrichment(scoreResult?.data) && !stockScorePayloadNeedsEnrichment(scoreResult?.payload);
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
