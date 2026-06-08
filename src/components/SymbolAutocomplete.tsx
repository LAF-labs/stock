"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeSymbolItemForQuery, shouldFetchSymbolSearch } from "@/components/symbolAutocompleteHelpers";
import { directInputSymbolItem } from "@/components/stockDashboardHelpers";
import { symbolDisplayName } from "@/lib/symbolDisplay";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

type SymbolSearchPayload = {
  ok?: boolean;
  items?: SymbolSearchItem[];
};

type SymbolAutocompleteProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
  placeholder: string;
  buttonLabel: string;
  label: string;
  disabled?: boolean;
  className?: string;
};

function displayInputValue(item: SymbolSearchItem): string {
  return symbolDisplayName(item);
}

function displaySubtitle(item: SymbolSearchItem): string {
  return [item.market === "US" ? "미장" : "국장", item.exchangeName || item.exchange].filter(Boolean).join(" · ");
}

export default function SymbolAutocomplete({
  id,
  value,
  onValueChange,
  onSelect,
  placeholder,
  buttonLabel,
  label,
  disabled = false,
  className = "",
}: SymbolAutocompleteProps) {
  const [items, setItems] = useState<SymbolSearchItem[]>([]);
  const [itemsQuery, setItemsQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const query = value.trim();
  const directItem = directInputSymbolItem(query);

  useEffect(() => {
    const controller = new AbortController();
    setActiveIndex(0);

    if (!query) {
      setItems([]);
      setItemsQuery("");
      setIsOpen(false);
      setIsLoading(false);
      setHasSearched(false);
      setSearchError(false);
      return () => controller.abort();
    }

    setItems([]);
    setItemsQuery("");
    setIsOpen(false);
    setHasSearched(false);
    setSearchError(false);
    if (!shouldFetchSymbolSearch(query)) {
      setIsLoading(false);
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      fetch(`/api/symbols?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
        cache: "force-cache",
      })
        .then(async (response) => {
          const payload = (await response.json()) as SymbolSearchPayload;
          if (!response.ok || !payload.ok) throw new Error("symbol search failed");
          return payload.items || [];
        })
        .then((nextItems) => {
          if (controller.signal.aborted) return;
          setItems(nextItems);
          setItemsQuery(query);
          setActiveIndex(0);
          setHasSearched(true);
          setIsOpen(Boolean(query && nextItems.length && document.activeElement === inputRef.current));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setItems([]);
          setItemsQuery(query);
          setIsOpen(false);
          setHasSearched(true);
          setSearchError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, query ? 120 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const visibleItems = itemsQuery === query ? items : [];
  const activeItem = useMemo(() => activeSymbolItemForQuery(items, itemsQuery, query, activeIndex), [activeIndex, items, itemsQuery, query]);
  const canSubmit = Boolean(activeItem || directItem) && !disabled;
  const activeOptionId = isOpen && activeItem ? `${listId}-option-${activeIndex}` : undefined;
  const searchStatus = isLoading
    ? "종목을 검색하고 있어요."
    : searchError
      ? "종목 검색에 실패했어요."
      : hasSearched
        ? visibleItems.length
          ? `검색 결과 ${visibleItems.length}개`
          : "검색 결과가 없어요."
        : "";

  function selectItem(item: SymbolSearchItem) {
    onValueChange(displayInputValue(item));
    inputRef.current?.blur();
    setIsOpen(false);
    onSelect(item);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeItem) {
      selectItem(activeItem);
      return;
    }
    if (directItem) {
      onSelect(directItem);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp") && visibleItems.length) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(event.key === "ArrowUp" ? visibleItems.length - 1 : 0);
      return;
    }
    if (!isOpen && event.key !== "Enter") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, visibleItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, visibleItems.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) {
        selectItem(activeItem);
      } else if (directItem) {
        onSelect(directItem);
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="symbol-search-box" ref={wrapperRef}>
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={() => setIsOpen(Boolean(query && visibleItems.length))}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-busy={isLoading}
        />
        <button type="submit" disabled={!canSubmit}>
          {isLoading ? "찾는 중" : buttonLabel}
        </button>
        {isOpen ? (
          <div className="symbol-suggestions" id={listId} role="listbox">
            {visibleItems.map((item, index) => (
              <button
                key={item.key}
                id={`${listId}-option-${index}`}
                type="button"
                className={index === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectItem(item)}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
              >
                <span>{symbolDisplayName(item)}</span>
                <small>{displaySubtitle(item)}</small>
              </button>
            ))}
          </div>
        ) : null}
        <p id={statusId} className="sr-only" role="status" aria-live="polite">
          {searchStatus}
        </p>
      </div>
    </form>
  );
}
