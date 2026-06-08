import type { SymbolSearchItem } from "@/lib/symbolTypes";

export function shouldFetchSymbolSearch(query: string): boolean {
  return query.trim().length >= 2;
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
