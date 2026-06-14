export type CompareSelectedTickerEntry = {
  ticker: string;
  label: string;
  removeDisabled: boolean;
};

type CompareSelectedTickerListProps = {
  entries: CompareSelectedTickerEntry[];
  onRemove: (ticker: string) => void;
  emptyLabel: string;
  className?: string;
};

export default function CompareSelectedTickerList({
  entries,
  onRemove,
  emptyLabel,
  className = "",
}: CompareSelectedTickerListProps) {
  return (
    <div className={["compare-pick-list", className].filter(Boolean).join(" ")}>
      {entries.length ? entries.map((entry) => (
        <span key={entry.ticker}>
          <em className="compare-pick-label">{entry.label}</em>
          <button
            type="button"
            onClick={() => onRemove(entry.ticker)}
            aria-label={`${entry.label} 삭제`}
            disabled={entry.removeDisabled}
          >
            ×
          </button>
        </span>
      )) : (
        <span className="is-empty">
          <em className="compare-pick-label">{emptyLabel}</em>
        </span>
      )}
    </div>
  );
}
