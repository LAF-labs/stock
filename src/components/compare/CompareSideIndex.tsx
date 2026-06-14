"use client";

import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import CompareSelectedTickerList, { type CompareSelectedTickerEntry } from "@/components/compare/CompareSelectedTickerList";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

type CompareSideIndexProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
  compareLimitReached: boolean;
  selectedCount: number;
  maxCompare: number;
  selectedTickers: CompareSelectedTickerEntry[];
  onRemoveTicker: (ticker: string) => void;
};

export default function CompareSideIndex({
  value,
  onValueChange,
  onSelect,
  compareLimitReached,
  selectedCount,
  maxCompare,
  selectedTickers,
  onRemoveTicker,
}: CompareSideIndexProps) {
  return (
    <nav className="stock-detail-index compare-side-index" aria-label="비교 종목 편집">
      <span>비교 종목</span>
      <SymbolAutocomplete
        id="compare-side-ticker"
        value={value}
        onValueChange={onValueChange}
        onSelect={onSelect}
        placeholder={compareLimitReached ? "최대 5개입니다" : "비교할 종목 검색"}
        buttonLabel={compareLimitReached ? "완료" : "추가"}
        label="비교할 국내·미국 주식 검색"
        disabled={compareLimitReached}
        className="stock-search-form compare-add-form compare-index-search"
      />
      <div className="compare-side-selection">
        <strong>{selectedCount}/{maxCompare}</strong>
        <CompareSelectedTickerList
          entries={selectedTickers}
          onRemove={onRemoveTicker}
          emptyLabel="비교할 종목을 추가해주세요"
          className="compare-index-picks"
        />
      </div>
    </nav>
  );
}
