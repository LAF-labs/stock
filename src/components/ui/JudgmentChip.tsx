import type { HTMLAttributes, ReactNode } from "react";

type JudgmentChipTone = "neutral" | "positive" | "negative" | "warning" | "accent";

type JudgmentChipAccessibleName =
  | {
      children: ReactNode;
      "aria-label"?: string;
    }
  | {
      children?: ReactNode;
      "aria-label": string;
    };

type JudgmentChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "children" | "aria-label"> & {
  tone?: JudgmentChipTone;
  icon?: ReactNode;
} & JudgmentChipAccessibleName;

export default function JudgmentChip({ tone = "neutral", icon, className = "", children, ...props }: JudgmentChipProps) {
  return (
    <span className={["ui-judgment-chip", `ui-judgment-chip--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export type { JudgmentChipProps, JudgmentChipTone };
