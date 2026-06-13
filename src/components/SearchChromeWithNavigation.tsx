"use client";

import type { ReactNode } from "react";
import AppNavigationMenu from "@/components/AppNavigationMenu";
import type { AppNavigationContext } from "@/components/appNavigationMenuHelpers";
import type { CollapsibleSearchChrome } from "@/components/useCollapsibleSearchChrome";

type SearchChromeWithNavigationProps = {
  className: string;
  context: AppNavigationContext;
  searchChrome: CollapsibleSearchChrome;
  children: ReactNode;
};

export default function SearchChromeWithNavigation({
  className,
  context,
  searchChrome,
  children,
}: SearchChromeWithNavigationProps) {
  return (
    <>
      <span ref={searchChrome.anchorRef} className="search-chrome-scroll-anchor" aria-hidden="true" />
      <section ref={searchChrome.containerRef} className={searchChrome.className(className)}>
        <AppNavigationMenu context={context} />
        {children}
      </section>
    </>
  );
}
