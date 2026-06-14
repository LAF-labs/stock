"use client";

import { useMemo } from "react";
import AppShellNav from "@/components/layout/AppShellNav";
import MobileNavLauncher from "@/components/layout/MobileNavLauncher";
import {
  globalNavigationItemsForContext,
  type AppNavigationContext,
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

  return (
    <div className={["app-navigation-chrome", className].filter(Boolean).join(" ")}>
      <AppShellNav items={items} />
      {!suppressMobileChrome ? (
        <MobileNavLauncher items={items} mobileContextAction={mobileContextAction} />
      ) : null}
    </div>
  );
}
