import type { RefObject } from "react";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import CompareSelectedTickerList, { type CompareSelectedTickerEntry } from "@/components/compare/CompareSelectedTickerList";
import { Sheet, Button } from "@/components/ui";
import { MAX_COMPARE } from "@/components/stockCompareHelpers";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

type CompareEditSheetProps = {
  isOpen: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
  onClose: () => void;
  compareLimitReached: boolean;
  selectedCount: number;
  selectedTickers: CompareSelectedTickerEntry[];
  onRemoveTicker: (ticker: string) => void;
  closeLabel: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export default function CompareEditSheet({
  isOpen,
  value,
  onValueChange,
  onSelect,
  onClose,
  compareLimitReached,
  selectedCount,
  selectedTickers,
  onRemoveTicker,
  closeLabel,
  returnFocusRef,
}: CompareEditSheetProps) {
  return (
    <Sheet open={isOpen} labelledBy="compare-add-sheet-title" onClose={onClose} returnFocusRef={returnFocusRef} className="compare-add-sheet">
      <header className="compare-sheet-header">
        <div>
          <span>종목 편집</span>
          <h2 id="compare-add-sheet-title">비교 종목 편집</h2>
        </div>
        <Button variant="secondary" size="md" onClick={onClose}>{closeLabel}</Button>
      </header>
      <section className="compare-sheet-selection" aria-label="선택한 종목">
        <div>
          <span>선택한 종목</span>
          <strong>{selectedCount}/{MAX_COMPARE}</strong>
        </div>
        <CompareSelectedTickerList
          entries={selectedTickers}
          onRemove={onRemoveTicker}
          emptyLabel="아직 선택한 종목이 없어요"
          className="compare-sheet-picks"
        />
      </section>
      <SymbolAutocomplete
        id="compare-ticker-sheet"
        value={value}
        onValueChange={onValueChange}
        onSelect={onSelect}
        placeholder={compareLimitReached ? "종목을 빼면 다시 추가할 수 있어요" : "추가할 종목명 또는 티커"}
        buttonLabel={compareLimitReached ? "완료" : "추가"}
        label="비교할 국내·미국 주식 검색"
        disabled={compareLimitReached}
        className="stock-search-form compare-add-form compare-sheet-search"
        autoFocusOnMount
      />
    </Sheet>
  );
}
