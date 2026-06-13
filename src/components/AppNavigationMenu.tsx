"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, FileText, GitCompareArrows, Menu, PencilLine, Plus, Search } from "lucide-react";
import AppNavigationLinks from "@/components/AppNavigationLinks";
import {
  globalNavigationItemsForContext,
  mobileContextActionVariant,
  nextMobileNavigationOpen,
  type AppNavigationContext,
  type AppNavigationItem,
  type GlobalNavigationId,
  type MobileContextActionVariant,
} from "@/components/appNavigationMenuHelpers";

type MobileContextAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: "plus" | "edit";
  onClick: () => void;
};

type AppNavigationMenuProps = {
  context: AppNavigationContext;
  className?: string;
  mobileContextAction?: MobileContextAction;
  suppressMobileChrome?: boolean;
};

export default function AppNavigationMenu({
  context,
  className = "",
  mobileContextAction,
  suppressMobileChrome = false,
}: AppNavigationMenuProps) {
  const items = useMemo(() => globalNavigationItemsForContext(context), [context]);
  const mobileNavigation = useMobileFloatingNavigation();
  const MobileContextIcon = mobileContextAction?.icon === "edit" ? PencilLine : Plus;

  return (
    <div className={["app-navigation-chrome", className].filter(Boolean).join(" ")}>
      <nav className="app-desktop-nav" aria-label="주요 페이지">
        <div className="app-desktop-nav-inner">
          <a className="app-desktop-nav-brand" href="/">스톡스토커</a>
          <AppNavigationLinks items={items} variant="global" className="app-desktop-nav-links" />
        </div>
      </nav>

      {!suppressMobileChrome && mobileNavigation.isOpen ? (
        <button
          type="button"
          className="app-bottom-nav-backdrop"
          aria-label="주요 페이지 메뉴 닫기"
          onClick={mobileNavigation.closeFromOutside}
        />
      ) : null}

      {!suppressMobileChrome ? (
        <button
          type="button"
          className={["app-bottom-menu-trigger", mobileNavigation.isOpen ? "is-hidden" : ""].filter(Boolean).join(" ")}
          aria-label="주요 페이지 메뉴 열기"
          aria-expanded={mobileNavigation.isOpen}
          onClick={mobileNavigation.toggle}
        >
          <Menu aria-hidden="true" />
        </button>
      ) : null}

      {!suppressMobileChrome ? (
        <nav className={["app-bottom-nav", mobileNavigation.isOpen ? "is-open" : ""].filter(Boolean).join(" ")} aria-label="주요 페이지" aria-hidden={!mobileNavigation.isOpen}>
          {items.map((item) => (
            <BottomNavigationLink
              key={`${item.id}:${item.href}`}
              item={item}
              tabIndex={mobileNavigation.isOpen ? undefined : -1}
            />
          ))}
        </nav>
      ) : null}
      {!suppressMobileChrome && mobileContextAction ? (
        <button
          type="button"
          className={[
            "app-bottom-context-action",
            mobileNavigation.contextActionVariant === "compact" ? "is-compact" : "",
          ].filter(Boolean).join(" ")}
          disabled={mobileContextAction.disabled}
          aria-label={mobileContextAction.ariaLabel || mobileContextAction.label}
          onClick={() => {
            mobileNavigation.closeFromOutside();
            mobileContextAction.onClick();
          }}
        >
          <MobileContextIcon aria-hidden="true" />
          <span>{mobileContextAction.label}</span>
        </button>
      ) : null}
    </div>
  );
}

function BottomNavigationLink({ item, tabIndex }: { item: AppNavigationItem; tabIndex?: number }) {
  const Icon = iconForItem(item.id);
  return (
    <a className={["app-bottom-nav-item", item.active ? "active" : ""].filter(Boolean).join(" ")} href={item.href} aria-current={item.active ? "page" : undefined} tabIndex={tabIndex}>
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

function useMobileFloatingNavigation(): {
  isOpen: boolean;
  contextActionVariant: MobileContextActionVariant;
  toggle: () => void;
  closeFromOutside: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [contextActionVariant, setContextActionVariant] = useState<MobileContextActionVariant>(() => (
    typeof window === "undefined" ? "full" : mobileContextActionVariant(window.scrollY)
  ));

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      setContextActionVariant(mobileContextActionVariant(window.scrollY));
      setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "scroll" }));
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

  return {
    isOpen,
    contextActionVariant,
    toggle: () => setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "toggle" })),
    closeFromOutside: () => setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "outside" })),
  };
}
