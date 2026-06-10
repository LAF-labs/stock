"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeSymbolItemForQuery } from "@/components/symbolAutocompleteHelpers";
import { directInputSymbolItem } from "@/components/stockDashboardHelpers";
import { useSymbolSearchQuery } from "@/components/useSymbolSearchQuery";
import { symbolDisplayName } from "@/lib/symbolDisplay";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

type SymbolAutocompleteProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
  placeholder: string;
  buttonLabel?: string;
  label: string;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "floating";
  isCollapsed?: boolean;
  onExpandRequest?: () => void;
};

function displayInputValue(item: SymbolSearchItem): string {
  return symbolDisplayName(item);
}

function displaySubtitle(item: SymbolSearchItem): string {
  return [item.market === "US" ? "미장" : "국장", item.exchangeName || item.exchange].filter(Boolean).join(" · ");
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export default function SymbolAutocomplete({
  id,
  value,
  onValueChange,
  onSelect,
  placeholder,
  buttonLabel = "검색",
  label,
  disabled = false,
  className = "",
  variant = "default",
  isCollapsed = false,
  onExpandRequest,
}: SymbolAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const symbolSearch = useSymbolSearchQuery(value);
  const query = symbolSearch.query;
  const directItem = directInputSymbolItem(query);

  useEffect(() => {
    setActiveIndex(0);
    if (!query) {
      setIsOpen(false);
      return;
    }
  }, [query]);

  useEffect(() => {
    setIsOpen(Boolean(query && symbolSearch.visibleItems.length && document.activeElement === inputRef.current));
  }, [query, symbolSearch.visibleItems.length]);

  useEffect(() => {
    if (isCollapsed) setIsOpen(false);
  }, [isCollapsed]);

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
  const visibleItems = symbolSearch.visibleItems;
  const activeItem = useMemo(() => activeSymbolItemForQuery(symbolSearch.items, symbolSearch.resultQuery, query, activeIndex), [activeIndex, symbolSearch.items, symbolSearch.resultQuery, query]);
  const canSubmit = Boolean(activeItem || directItem) && !disabled;
  const activeOptionId = isOpen && activeItem ? `${listId}-option-${activeIndex}` : undefined;
  const isFloating = variant === "floating";
  const formClassName = [className, isFloating ? "symbol-autocomplete-floating" : "", isFloating && isCollapsed ? "is-collapsed" : ""].filter(Boolean).join(" ");
  const actionLabel = isCollapsed ? "검색창 펼치기" : query ? "검색어 지우기" : "종목 검색";
  const searchStatus = symbolSearch.isLoading
    ? "종목을 검색하고 있어요."
    : symbolSearch.error
      ? "종목 검색에 실패했어요."
      : symbolSearch.searched
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

  function focusInput() {
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }

  function onFloatingAction() {
    if (disabled) return;
    if (isCollapsed) {
      onExpandRequest?.();
      focusInput();
      return;
    }
    if (query) {
      onValueChange("");
      setIsOpen(false);
      focusInput();
      return;
    }
    focusInput();
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
    <form onSubmit={submit} className={formClassName}>
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
          aria-busy={symbolSearch.isLoading}
        />
        {isFloating ? (
          <button
            type="button"
            className={`symbol-search-action ${!isCollapsed && query ? "clear" : "search"}`}
            disabled={disabled}
            aria-label={actionLabel}
            onClick={onFloatingAction}
          >
            {!isCollapsed && query ? <ClearIcon /> : <SearchIcon />}
          </button>
        ) : (
          <button type="submit" disabled={!canSubmit}>
            {symbolSearch.isLoading ? "찾는 중" : buttonLabel}
          </button>
        )}
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
