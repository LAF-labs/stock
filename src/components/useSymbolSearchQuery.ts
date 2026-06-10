"use client";

import { useEffect, useMemo, useState } from "react";
import { shouldFetchSymbolSearch } from "@/components/symbolAutocompleteHelpers";
import { symbolSearchQueryOptions } from "@/lib/stockQueryOptions";
import { useQuery } from "@tanstack/react-query";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

export type SymbolSearchQueryView = {
  query: string;
  items: SymbolSearchItem[];
  resultQuery: string;
  visibleItems: SymbolSearchItem[];
  isLoading: boolean;
  searched: boolean;
  error: boolean;
};

export function useSymbolSearchQuery(value: string): SymbolSearchQueryView {
  const query = value.trim();
  const debouncedQuery = useDebouncedValue(query, 120);
  const canFetchCurrentQuery = shouldFetchSymbolSearch(query);
  const searchQuery = useQuery(symbolSearchQueryOptions(debouncedQuery));
  const result = searchQuery.data?.state === "ready" ? searchQuery.data.data : undefined;
  const resultQuery = result?.query?.trim() || debouncedQuery;
  const items = useMemo(() => result?.items || [], [result]);
  const visibleItems = canFetchCurrentQuery && resultQuery === query ? items : [];
  const isDebouncing = canFetchCurrentQuery && query !== debouncedQuery;
  const isLoading = canFetchCurrentQuery && (isDebouncing || (searchQuery.isFetching && !visibleItems.length));
  const searched = canFetchCurrentQuery && query === debouncedQuery && (searchQuery.isSuccess || searchQuery.isError);
  const error = canFetchCurrentQuery && query === debouncedQuery && searchQuery.isError;

  return {
    query,
    items,
    resultQuery,
    visibleItems,
    isLoading,
    searched,
    error,
  };
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}
