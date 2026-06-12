"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import AppNavigationLinks from "@/components/AppNavigationLinks";
import { navigationItemsForContext, type AppNavigationContext } from "@/components/appNavigationMenuHelpers";

type AppNavigationMenuProps = {
  context: AppNavigationContext;
  className?: string;
  isSearchCollapsed?: boolean;
  isOpenSuppressed?: boolean;
  onCollapsedExpandRequest?: () => void;
};

export default function AppNavigationMenu({
  context,
  className = "",
  isSearchCollapsed = false,
  isOpenSuppressed = false,
  onCollapsedExpandRequest,
}: AppNavigationMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHoverOpenSuppressed, setIsHoverOpenSuppressed] = useState(false);
  const hoverSuppressTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const collapsedPointerResetTimerRef = useRef<number | undefined>(undefined);
  const collapsedExpandAtRef = useRef(0);
  const collapsedPointerDownRef = useRef(false);
  const items = useMemo(() => navigationItemsForContext(context), [context]);

  useEffect(() => () => {
    if (hoverSuppressTimerRef.current !== undefined) window.clearTimeout(hoverSuppressTimerRef.current);
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
    if (collapsedPointerResetTimerRef.current !== undefined) window.clearTimeout(collapsedPointerResetTimerRef.current);
  }, []);

  useEffect(() => {
    if ((isHoverOpenSuppressed || isOpenSuppressed) && isOpen) setIsOpen(false);
  }, [isHoverOpenSuppressed, isOpen, isOpenSuppressed]);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    cancelCloseMenu();
    if (collapsedPointerDownRef.current) {
      clearCollapsedPointerDown();
      return;
    }
    if (isOpenSuppressed) return;
    if (isSearchCollapsed || event.currentTarget.closest(".search-collapsed")) {
      collapsedExpandAtRef.current = Date.now();
      suppressHoverOpenBriefly();
      onCollapsedExpandRequest?.();
      return;
    }
    if (Date.now() - collapsedExpandAtRef.current < 450) return;
    setIsOpen((open) => !open);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isSearchCollapsed && !event.currentTarget.closest(".search-collapsed")) return;
    rememberCollapsedPointerDown();
    collapsedExpandAtRef.current = Date.now();
    suppressHoverOpenBriefly();
    onCollapsedExpandRequest?.();
    event.preventDefault();
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
    if (!isSearchCollapsed && !event.currentTarget.closest(".search-collapsed")) return;
    rememberCollapsedPointerDown();
    collapsedExpandAtRef.current = Date.now();
    suppressHoverOpenBriefly();
    onCollapsedExpandRequest?.();
    event.preventDefault();
  }

  function handleMenuMouseEnter(event: ReactMouseEvent<HTMLElement>) {
    cancelCloseMenu();
    if (event.currentTarget.closest(".search-collapsed")) collapsedExpandAtRef.current = Date.now();
    if (canHoverOpen() && !isSearchCollapsed && !isHoverOpenSuppressed && !isOpenSuppressed) setIsOpen(true);
  }

  const isMenuVisible = isOpen && !isOpenSuppressed && !isHoverOpenSuppressed;

  function cancelCloseMenu() {
    if (closeTimerRef.current === undefined) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }

  function closeMenuSoon() {
    if (!canHoverOpen()) return;
    cancelCloseMenu();
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = undefined;
    }, 180);
  }

  function rememberCollapsedPointerDown() {
    collapsedPointerDownRef.current = true;
    if (collapsedPointerResetTimerRef.current !== undefined) window.clearTimeout(collapsedPointerResetTimerRef.current);
    collapsedPointerResetTimerRef.current = window.setTimeout(() => {
      collapsedPointerDownRef.current = false;
      collapsedPointerResetTimerRef.current = undefined;
    }, 320);
  }

  function clearCollapsedPointerDown() {
    collapsedPointerDownRef.current = false;
    if (collapsedPointerResetTimerRef.current === undefined) return;
    window.clearTimeout(collapsedPointerResetTimerRef.current);
    collapsedPointerResetTimerRef.current = undefined;
  }

  function suppressHoverOpenBriefly() {
    setIsHoverOpenSuppressed(true);
    if (hoverSuppressTimerRef.current !== undefined) window.clearTimeout(hoverSuppressTimerRef.current);
    hoverSuppressTimerRef.current = window.setTimeout(() => {
      setIsHoverOpenSuppressed(false);
      hoverSuppressTimerRef.current = undefined;
    }, 420);
  }

  return (
    <nav
      className={["app-navigation-menu", isMenuVisible ? "is-open" : "", className].filter(Boolean).join(" ")}
      aria-label="페이지 이동 메뉴"
      onMouseEnter={handleMenuMouseEnter}
      onMouseLeave={closeMenuSoon}
    >
      <button
        type="button"
        className="app-navigation-trigger"
        aria-label="페이지 이동 메뉴"
        aria-expanded={isMenuVisible}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        onClick={toggleMenu}
      >
        <Menu aria-hidden="true" />
      </button>
      {isMenuVisible ? (
        <>
          <div className="app-navigation-backdrop" aria-hidden="true" onClick={() => setIsOpen(false)} />
          <div className="app-navigation-popover" role="menu" onMouseEnter={cancelCloseMenu} onMouseLeave={closeMenuSoon}>
            <AppNavigationLinks items={items} variant="popover" onNavigate={() => setIsOpen(false)} />
          </div>
        </>
      ) : null}
    </nav>
  );
}

function canHoverOpen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 641px)").matches;
}
