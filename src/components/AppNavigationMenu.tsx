"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, FileText, GitCompareArrows, Plus, Search } from "lucide-react";
import AppNavigationLinks from "@/components/AppNavigationLinks";
import {
  globalNavigationItemsForContext,
  nextBottomNavigationHidden,
  type AppNavigationContext,
  type AppNavigationItem,
  type GlobalNavigationId,
} from "@/components/appNavigationMenuHelpers";

type MobileContextAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
};

type AppNavigationMenuProps = {
  context: AppNavigationContext;
  className?: string;
  mobileContextAction?: MobileContextAction;
};

export default function AppNavigationMenu({
  context,
  className = "",
  mobileContextAction,
}: AppNavigationMenuProps) {
  const items = useMemo(() => globalNavigationItemsForContext(context), [context]);
  const isHidden = useBottomNavigationHidden();

  return (
    <div className={["app-navigation-chrome", className].filter(Boolean).join(" ")}>
      <nav className="app-desktop-nav" aria-label="주요 페이지">
        <div className="app-desktop-nav-inner">
          <a className="app-desktop-nav-brand" href="/">스톡스토커</a>
          <AppNavigationLinks items={items} variant="global" className="app-desktop-nav-links" />
        </div>
      </nav>

      <nav className={["app-bottom-nav", isHidden ? "is-hidden" : ""].filter(Boolean).join(" ")} aria-label="주요 페이지">
        {items.map((item) => <BottomNavigationLink key={`${item.id}:${item.href}`} item={item} />)}
      </nav>
      {mobileContextAction ? (
        <button
          type="button"
          className={["app-bottom-context-action", isHidden ? "is-hidden" : ""].filter(Boolean).join(" ")}
          disabled={mobileContextAction.disabled}
          aria-label={mobileContextAction.ariaLabel || mobileContextAction.label}
          onClick={mobileContextAction.onClick}
        >
          <Plus aria-hidden="true" />
          <span>{mobileContextAction.label}</span>
        </button>
      ) : null}
    </div>
  );
}

function BottomNavigationLink({ item }: { item: AppNavigationItem }) {
  const Icon = iconForItem(item.id);
  return (
    <a className={["app-bottom-nav-item", item.active ? "active" : ""].filter(Boolean).join(" ")} href={item.href} aria-current={item.active ? "page" : undefined}>
      <Icon aria-hidden="true" />
      <span>{item.shortLabel || item.label}</span>
    </a>
  );
}

function iconForItem(id: GlobalNavigationId | undefined) {
  if (id === "detail") return FileText;
  if (id === "compare") return GitCompareArrows;
  if (id === "marketCap") return BarChart3;
  return Search;
}

function useBottomNavigationHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const nextScrollY = window.scrollY;
      const delta = nextScrollY - lastScrollY;
      lastScrollY = nextScrollY;
      setHidden((currentHidden) => nextBottomNavigationHidden({ currentHidden, scrollY: nextScrollY, delta }));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return hidden;
}
