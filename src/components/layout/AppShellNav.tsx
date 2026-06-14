import AppNavigationLinks from "@/components/AppNavigationLinks";
import AppGlobalSearch from "@/components/layout/AppGlobalSearch";
import type { AppNavigationItem } from "@/components/appNavigationMenuHelpers";

type AppShellNavProps = {
  items: ReadonlyArray<AppNavigationItem>;
};

export default function AppShellNav({ items }: AppShellNavProps) {
  return (
    <nav className="app-desktop-nav" aria-label="주요 페이지">
      <div className="app-desktop-nav-inner">
        <div className="app-desktop-nav-left">
          <a className="app-desktop-nav-brand" href="/">스톡스토커</a>
          <AppNavigationLinks items={items} variant="global" className="app-desktop-nav-links" />
        </div>
        <AppGlobalSearch />
      </div>
    </nav>
  );
}
