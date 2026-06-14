"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type SheetProps = {
  open: boolean;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  modal?: boolean;
  role?: "dialog" | "region";
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export default function Sheet({
  open,
  labelledBy,
  children,
  className = "",
  modal = true,
  role = "dialog",
  returnFocusRef,
  onClose,
}: SheetProps) {
  const panelRef = useRef<HTMLElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const panel = panelRef.current;
    const focusTarget = focusableElements(panel)[0];

    (focusTarget ?? panel)?.focus();

    return () => {
      (returnFocusRef?.current ?? previousActiveElementRef.current)?.focus();
      previousActiveElementRef.current = null;
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = focusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      className={["ui-sheet", className].filter(Boolean).join(" ")}
      role={role}
      aria-modal={modal}
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
    >
      <div className="ui-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section ref={panelRef} className="ui-sheet-panel" tabIndex={-1}>{children}</section>
    </div>
  );
}

function focusableElements(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    element.tabIndex !== -1 && !element.hasAttribute("disabled") && element.getClientRects().length > 0
  ));
}

export type { SheetProps };
