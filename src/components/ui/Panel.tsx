import type { HTMLAttributes } from "react";

type PanelTone = "default" | "subtle" | "accent";

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  tone?: PanelTone;
};

export default function Panel({
  as: Component = "section",
  tone = "default",
  className = "",
  ...props
}: PanelProps) {
  return <Component className={["ui-panel", `ui-panel--${tone}`, className].filter(Boolean).join(" ")} {...props} />;
}

export type { PanelProps, PanelTone };
