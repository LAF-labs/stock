import type { HTMLAttributes, ReactNode } from "react";

type MetricTileProps = HTMLAttributes<HTMLElement> & {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "accent" | "positive" | "negative";
};

export default function MetricTile({ label, value, caption, tone = "default", className = "", ...props }: MetricTileProps) {
  return (
    <article className={["ui-metric-tile", `ui-metric-tile--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      <span>{label}</span>
      <strong>{value}</strong>
      {caption ? <small>{caption}</small> : null}
    </article>
  );
}

export type { MetricTileProps };
