import type { AppNavigationItem } from "@/components/appNavigationMenuHelpers";

type AppNavigationLinksVariant = "popover" | "index";

type AppNavigationLinksProps = {
  items: ReadonlyArray<AppNavigationItem>;
  variant: AppNavigationLinksVariant;
  className?: string;
  ariaLabel?: string;
  onNavigate?: () => void;
};

export default function AppNavigationLinks({
  items,
  variant,
  className,
  ariaLabel,
  onNavigate,
}: AppNavigationLinksProps) {
  if (!items.length) return null;

  const links = items.map((item) => (
    <a
      key={`${item.label}:${item.href}`}
      href={item.href}
      role={variant === "popover" ? "menuitem" : undefined}
      onClick={onNavigate}
    >
      {item.label}
    </a>
  ));

  if (!className && !ariaLabel) return <>{links}</>;

  return (
    <div className={className} aria-label={ariaLabel}>
      {links}
    </div>
  );
}
