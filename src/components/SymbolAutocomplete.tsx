"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  return item.market === "KR" ? item.koreanName || item.ticker : item.displayName || item.ticker;
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
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const query = value.trim();
  const normalizedQueryTicker = query.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const canSubmit = Boolean(normalizedQueryTicker) && !disabled;

  useEffect(() => {
    const controller = new AbortController();
    setActiveIndex(0);

    if (!query) {
      setItems([]);
      setIsOpen(false);
      setIsLoading(false);
      return () => controller.abort();
    }

    setItems([]);
    setIsOpen(false);
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
          setActiveIndex(0);
          setIsOpen(Boolean(query && nextItems.length && document.activeElement === inputRef.current));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setItems([]);
          setIsOpen(false);
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
  const activeItem = useMemo(() => items[activeIndex] || items[0], [activeIndex, items]);
  const activeOptionId = isOpen && activeItem ? `${listId}-option-${activeIndex}` : undefined;

  function directInputItem(): SymbolSearchItem {
    const ticker = normalizedQueryTicker;
    return {
      key: ticker,
      market: /^\d{6}$/.test(ticker) ? "KR" : "US",
      ticker,
      displayName: ticker,
      subtitle: ticker,
      exchange: "",
      exchangeName: "직접 입력",
      koreanName: "",
      englishName: ticker,
      instrumentType: "STOCK",
    };
  }

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
    if (query) {
      onSelect(directInputItem());
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && event.key !== "Enter") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) {
        selectItem(activeItem);
      } else if (query) {
        onSelect(directInputItem());
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
          onFocus={() => setIsOpen(Boolean(query && items.length))}
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
        />
        <button type="submit" disabled={!canSubmit}>
          {isLoading ? "찾는 중" : buttonLabel}
        </button>
        {isOpen ? (
          <div className="symbol-suggestions" id={listId} role="listbox">
            {items.map((item, index) => (
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
              >
                <span>{item.displayName}</span>
                <small>
                  <strong>{item.ticker}</strong>
                  <em>{item.market === "US" ? "미장" : "국장"} · {item.exchangeName}</em>
                </small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </form>
  );
}
