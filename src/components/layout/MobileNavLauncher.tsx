"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { BarChart3, FileText, GitCompareArrows, Menu, PencilLine, Plus, Search } from "lucide-react";
import { FloatingActionButton } from "@/components/ui";
import {
  mobileContextActionVariant,
  nextMobileNavigationOpen,
  type AppNavigationItem,
  type GlobalNavigationId,
  type MobileContextActionVariant,
} from "@/components/appNavigationMenuHelpers";

type MobileContextAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: "plus" | "edit";
  controlRef?: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
};

type MobileNavLauncherProps = {
  items: ReadonlyArray<AppNavigationItem>;
  mobileContextAction?: MobileContextAction;
};

export default function MobileNavLauncher({ items, mobileContextAction }: MobileNavLauncherProps) {
  const mobileNavigation = useMobileFloatingNavigation();
  const navRef = useRef<HTMLElement>(null);
  const MobileContextIcon = mobileContextAction?.icon === "edit" ? PencilLine : Plus;

  useEffect(() => {
    if (!mobileNavigation.isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      navRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mobileNavigation.isOpen]);

  return (
    <>
      {mobileNavigation.isOpen ? (
        <button
          type="button"
          className="app-bottom-nav-backdrop"
          aria-label="주요 페이지 메뉴 닫기"
          onClick={mobileNavigation.closeFromOutside}
        />
      ) : null}

      <button
        type="button"
        className={["app-bottom-menu-trigger", mobileNavigation.isOpen ? "is-hidden" : ""].filter(Boolean).join(" ")}
        aria-label="주요 페이지 메뉴 열기"
        aria-expanded={mobileNavigation.isOpen}
        aria-hidden={mobileNavigation.isOpen ? true : undefined}
        tabIndex={mobileNavigation.isOpen ? -1 : undefined}
        onClick={mobileNavigation.toggle}
      >
        <Menu aria-hidden="true" />
      </button>

      <nav
        ref={navRef}
        className={["app-bottom-nav", mobileNavigation.isOpen ? "is-open" : ""].filter(Boolean).join(" ")}
        aria-label="주요 페이지"
        aria-hidden={!mobileNavigation.isOpen}
      >
        {items.map((item) => (
          <BottomNavigationLink
            key={`${item.id}:${item.href}`}
            item={item}
            tabIndex={mobileNavigation.isOpen ? undefined : -1}
          />
        ))}
      </nav>

      {mobileContextAction ? (
        <FloatingActionButton
          ref={mobileContextAction.controlRef}
          className="app-bottom-context-action"
          disabled={mobileContextAction.disabled}
          aria-label={mobileContextAction.ariaLabel || mobileContextAction.label}
          icon={<MobileContextIcon aria-hidden="true" />}
          variant={mobileNavigation.contextActionVariant}
          onClick={() => {
            mobileNavigation.closeFromOutside();
            mobileContextAction.onClick();
          }}
        >
          {mobileContextAction.label}
        </FloatingActionButton>
      ) : null}
    </>
  );
}

function BottomNavigationLink({ item, tabIndex }: { item: AppNavigationItem; tabIndex?: number }) {
  const Icon = iconForItem(item.id);
  return (
    <a
      className={["app-bottom-nav-item", item.active ? "active" : ""].filter(Boolean).join(" ")}
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      tabIndex={tabIndex}
    >
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
