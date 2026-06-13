"use client";

import type { RefCallback } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type SearchChromeScrollDecision = "collapse" | "expand" | "keep";

export type SearchChromeScrollInput = {
  scrollY: number;
  delta: number;
  searchTop?: number;
  isFocusedWithin?: boolean;
};

type UseCollapsibleSearchChromeOptions = {
  scrollDecision: (input: SearchChromeScrollInput) => SearchChromeScrollDecision;
  expandAnimationMs?: number;
  navigationSuppressMs?: number;
};

export type CollapsibleSearchChrome = {
  isCollapsed: boolean;
  isExpanding: boolean;
  isNavigationOpenSuppressed: boolean;
  navigationResetKey: number;
  anchorRef: RefCallback<HTMLElement>;
  containerRef: RefCallback<HTMLElement>;
  className: (baseClassName: string) => string;
  setCollapsed: (nextCollapsed: boolean) => void;
  expandSearch: () => void;
  expandFromNavigation: () => void;
};

export function detailSearchScrollDecision({ scrollY, delta }: SearchChromeScrollInput): SearchChromeScrollDecision {
  if (scrollY <= 16) return "expand";
  if (delta > 0) return "collapse";
  if (delta < 0) return "expand";
  return "keep";
}

export function compareSearchScrollDecision(input: SearchChromeScrollInput): SearchChromeScrollDecision {
  const { scrollY, delta, searchTop, isFocusedWithin } = input;
  if (isFocusedWithin) return "expand";
  if (typeof searchTop === "number") {
    if (searchTop >= 0 || scrollY <= 16) return "expand";
    if (delta > 0) return "collapse";
    return "keep";
  }
  if (scrollY <= 16) return "expand";
  if (delta > 8 && scrollY > 92) return "collapse";
  if (delta < -24) return "expand";
  return "keep";
}

export function useCollapsibleSearchChrome({
  scrollDecision,
  expandAnimationMs = 380,
  navigationSuppressMs = 520,
}: UseCollapsibleSearchChromeOptions): CollapsibleSearchChrome {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isNavigationOpenSuppressed, setIsNavigationOpenSuppressed] = useState(false);
  const [navigationResetKey, setNavigationResetKey] = useState(0);
  const collapsedRef = useRef(false);
  const renderedCollapsedRef = useRef(false);
  const previousRenderedCollapsedRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const anchorElementRef = useRef<HTMLElement | null>(null);
  const containerElementRef = useRef<HTMLElement | null>(null);
  const containerDocumentTopRef = useRef<number | undefined>(undefined);
  const searchExpandTimerRef = useRef<number | undefined>(undefined);
  const navigationSuppressTimerRef = useRef<number | undefined>(undefined);

  const anchorRef = useCallback((node: HTMLElement | null) => {
    anchorElementRef.current = node;
  }, []);

  const containerRef = useCallback((node: HTMLElement | null) => {
    containerElementRef.current = node;
    containerDocumentTopRef.current = node ? node.getBoundingClientRect().top + window.scrollY : undefined;
  }, []);

  const clearNavigationSuppressTimer = useCallback(() => {
    if (navigationSuppressTimerRef.current === undefined) return;
    window.clearTimeout(navigationSuppressTimerRef.current);
    navigationSuppressTimerRef.current = undefined;
  }, []);

  const clearSearchExpandTimer = useCallback(() => {
    if (searchExpandTimerRef.current === undefined) return;
    window.clearTimeout(searchExpandTimerRef.current);
    searchExpandTimerRef.current = undefined;
  }, []);

  const scheduleNavigationOpenSuppressionRelease = useCallback(() => {
    clearNavigationSuppressTimer();
    navigationSuppressTimerRef.current = window.setTimeout(() => {
      setIsNavigationOpenSuppressed(false);
      navigationSuppressTimerRef.current = undefined;
    }, navigationSuppressMs);
  }, [clearNavigationSuppressTimer, navigationSuppressMs]);

  const beginExpandAnimation = useCallback(() => {
    setIsExpanding(true);
    scheduleNavigationOpenSuppressionRelease();
    clearSearchExpandTimer();
    searchExpandTimerRef.current = window.setTimeout(() => {
      setIsExpanding(false);
      searchExpandTimerRef.current = undefined;
    }, expandAnimationMs);
  }, [clearSearchExpandTimer, expandAnimationMs, scheduleNavigationOpenSuppressionRelease]);

  useEffect(() => {
    const wasCollapsed = previousRenderedCollapsedRef.current;
    renderedCollapsedRef.current = isCollapsed;
    previousRenderedCollapsedRef.current = isCollapsed;
    if (wasCollapsed && !isCollapsed && !isExpanding) beginExpandAnimation();
  }, [beginExpandAnimation, isCollapsed, isExpanding]);

  const applyCollapsedState = useCallback((nextCollapsed: boolean, forceExpandAnimation = false) => {
    const wasCollapsed = collapsedRef.current || renderedCollapsedRef.current;
    if (collapsedRef.current === nextCollapsed && renderedCollapsedRef.current === nextCollapsed && !(forceExpandAnimation && !nextCollapsed)) return;
    collapsedRef.current = nextCollapsed;
    renderedCollapsedRef.current = nextCollapsed;

    if (nextCollapsed) {
      setIsNavigationOpenSuppressed(true);
      clearNavigationSuppressTimer();
      clearSearchExpandTimer();
      setIsExpanding(false);
    } else if (wasCollapsed || forceExpandAnimation) {
      beginExpandAnimation();
    }

    setIsCollapsed(nextCollapsed);
  }, [beginExpandAnimation, clearNavigationSuppressTimer, clearSearchExpandTimer]);

  const setCollapsed = useCallback((nextCollapsed: boolean) => {
    applyCollapsedState(nextCollapsed);
  }, [applyCollapsedState]);

  const expandSearch = useCallback(() => {
    applyCollapsedState(false, true);
  }, [applyCollapsedState]);

  const expandFromNavigation = useCallback(() => {
    setIsNavigationOpenSuppressed(true);
    scheduleNavigationOpenSuppressionRelease();
    setNavigationResetKey((key) => key + 1);
    applyCollapsedState(false, true);
  }, [applyCollapsedState, scheduleNavigationOpenSuppressionRelease]);

  const className = useCallback((baseClassName: string) => (
    [baseClassName, isCollapsed ? "search-collapsed" : "", isExpanding ? "search-expanding" : ""].filter(Boolean).join(" ")
  ), [isCollapsed, isExpanding]);

  useEffect(() => {
    let ticking = false;
    lastScrollYRef.current = window.scrollY;

    function updateSearchChrome() {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollYRef.current;
      const anchor = anchorElementRef.current;
      const container = containerElementRef.current;
      const activeElement = document.activeElement;
      const isRenderedCollapsed = collapsedRef.current || renderedCollapsedRef.current;
      if (!anchor && container && (!isRenderedCollapsed || scrollY <= 16)) {
        containerDocumentTopRef.current = container.getBoundingClientRect().top + scrollY;
      }
      const searchTop = anchor
        ? anchor.getBoundingClientRect().top
        : containerDocumentTopRef.current !== undefined
          ? containerDocumentTopRef.current - scrollY
          : undefined;
      const isFocusedWithin = Boolean(container && activeElement && container.contains(activeElement));
      const decision = scrollDecision({ scrollY, delta, searchTop, isFocusedWithin });

      if (decision === "collapse") {
        setCollapsed(true);
      } else if (decision === "expand") {
        setCollapsed(false);
      }

      lastScrollYRef.current = scrollY;
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateSearchChrome);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [scrollDecision, setCollapsed]);

  useEffect(() => () => {
    clearNavigationSuppressTimer();
    clearSearchExpandTimer();
  }, [clearNavigationSuppressTimer, clearSearchExpandTimer]);

  return {
    isCollapsed,
    isExpanding,
    isNavigationOpenSuppressed,
    navigationResetKey,
    anchorRef,
    containerRef,
    className,
    setCollapsed,
    expandSearch,
    expandFromNavigation,
  };
}
