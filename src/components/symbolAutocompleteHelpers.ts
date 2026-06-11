import type { SymbolSearchItem } from "@/lib/symbolTypes";

export function shouldFetchSymbolSearch(query: string): boolean {
  return query.trim().length >= 2;
}

export function shouldFetchRemoteSymbolSearch(
  query: string,
  {
    localIndexReady,
    localItemCount,
    limit = 8,
  }: {
    localIndexReady: boolean;
    localItemCount: number;
    limit?: number;
  },
): boolean {
  if (!shouldFetchSymbolSearch(query)) return false;
  if (!localIndexReady) return true;
  return localItemCount < Math.max(1, limit);
}

export function activeSymbolItemForQuery(
  items: SymbolSearchItem[],
  resultQuery: string,
  currentQuery: string,
  activeIndex: number
): SymbolSearchItem | undefined {
  if (resultQuery !== currentQuery) return undefined;
  return items[activeIndex] || items[0];
}
