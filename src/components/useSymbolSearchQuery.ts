"use client";

import { useEffect, useMemo, useState } from "react";
import { shouldFetchSymbolSearch } from "@/components/symbolAutocompleteHelpers";
import { getClientSymbolSearchIndex } from "@/lib/clientSymbolSearch";
import { searchSymbolIndex, type SymbolSearchIndexEntry } from "@/lib/symbolLocalSearch";
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
  const [localIndex, setLocalIndex] = useState<SymbolSearchIndexEntry[] | undefined>();
  const canSearchLocalQuery = query.length >= 1;
  const canFetchCurrentQuery = shouldFetchSymbolSearch(query);
  const searchQuery = useQuery(symbolSearchQueryOptions(debouncedQuery));
  const result = searchQuery.data?.state === "ready" ? searchQuery.data.data : undefined;
  const remoteResultQuery = result?.query?.trim() || debouncedQuery;
  const localItems = useMemo(
    () => (canSearchLocalQuery && localIndex ? searchSymbolIndex(localIndex, { query, limit: 8 }) : []),
    [canSearchLocalQuery, localIndex, query],
  );
  const remoteItems = useMemo(
    () => (canFetchCurrentQuery && remoteResultQuery === query ? result?.items || [] : []),
    [canFetchCurrentQuery, query, remoteResultQuery, result],
  );
  const items = useMemo(() => mergeSymbolItems(localItems, remoteItems), [localItems, remoteItems]);
  const resultQuery = query;
  const visibleItems = canSearchLocalQuery ? items : [];
  const isDebouncing = canFetchCurrentQuery && query !== debouncedQuery;
  const isLoading = canFetchCurrentQuery && !visibleItems.length && (!localIndex || isDebouncing || searchQuery.isFetching);
  const searched = canSearchLocalQuery && (visibleItems.length > 0 || (query === debouncedQuery && (searchQuery.isSuccess || searchQuery.isError)));
  const error = canFetchCurrentQuery && query === debouncedQuery && searchQuery.isError && !visibleItems.length;

  useEffect(() => {
    let isActive = true;
    void getClientSymbolSearchIndex().then((index) => {
      if (isActive) setLocalIndex(index);
    });
    return () => {
      isActive = false;
    };
  }, []);

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

function mergeSymbolItems(localItems: SymbolSearchItem[], remoteItems: SymbolSearchItem[]): SymbolSearchItem[] {
  const seen = new Set<string>();
  const merged: SymbolSearchItem[] = [];
  for (const item of [...localItems, ...remoteItems]) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    merged.push(item);
    if (merged.length >= 8) break;
  }
  return merged;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}
