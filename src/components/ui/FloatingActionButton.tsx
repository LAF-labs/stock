import type { ButtonHTMLAttributes, ReactNode } from "react";

type FloatingActionButtonVariant = "full" | "compact";

type FloatingActionButtonAccessibleName =
  | {
      children: ReactNode;
      "aria-label"?: string;
    }
  | {
      children?: ReactNode;
      "aria-label": string;
    };

type FloatingActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: ReactNode;
  variant?: FloatingActionButtonVariant;
} & FloatingActionButtonAccessibleName;

export default function FloatingActionButton({
  icon,
  variant = "full",
  className = "",
  children,
  type = "button",
  ...props
}: FloatingActionButtonProps) {
  return (
    <button
      type={type}
      className={["ui-fab", variant === "compact" ? "ui-fab--compact" : "ui-fab--full", className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="ui-fab-icon" aria-hidden="true">{icon}</span>
      <span className="ui-fab-label">{children}</span>
    </button>
  );
}

export type { FloatingActionButtonProps, FloatingActionButtonVariant };
