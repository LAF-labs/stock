import type { AppNavigationItem } from "@/components/appNavigationMenuHelpers";

type AppNavigationLinksVariant = "global" | "bottom" | "index";

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
      className={item.active ? "active" : undefined}
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      onClick={onNavigate}
    >
      {variant === "bottom" ? (item.shortLabel || item.label) : item.label}
    </a>
  ));

  if (!className && !ariaLabel) return <>{links}</>;

  return (
    <div className={className} aria-label={ariaLabel}>
      {links}
    </div>
  );
}
