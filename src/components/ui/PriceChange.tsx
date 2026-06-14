import type { HTMLAttributes } from "react";

type PriceChangeTone = "positive" | "negative" | "neutral";

function priceChangeToneForValue(value: number | undefined): PriceChangeTone {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

type PriceChangeProps = HTMLAttributes<HTMLSpanElement> & {
  value?: number;
  children: string;
  tone?: PriceChangeTone;
};

export default function PriceChange({ value, tone = priceChangeToneForValue(value), className = "", children, ...props }: PriceChangeProps) {
  return (
    <span className={["ui-price-change", `ui-price-change--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}

export { priceChangeToneForValue };
export type { PriceChangeProps, PriceChangeTone };
