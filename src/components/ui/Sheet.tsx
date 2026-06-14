"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type SheetProps = {
  open: boolean;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  modal?: boolean;
  role?: "dialog" | "region";
  onClose: () => void;
};

export default function Sheet({
  open,
  labelledBy,
  children,
  className = "",
  modal = true,
  role = "dialog",
  onClose,
}: SheetProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const focusTarget = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    (focusTarget ?? panel)?.focus();
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
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

export type { SheetProps };
