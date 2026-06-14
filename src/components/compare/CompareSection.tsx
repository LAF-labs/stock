import type { HTMLAttributes, ReactNode } from "react";

type CompareSectionProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
};

export default function CompareSection({
  eyebrow,
  title,
  description,
  children,
  className = "",
  ...props
}: CompareSectionProps) {
  return (
    <section className={["compare-section", className].filter(Boolean).join(" ")} {...props}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {description ? <p className="compare-section-description">{description}</p> : null}
      {children}
    </section>
  );
}
