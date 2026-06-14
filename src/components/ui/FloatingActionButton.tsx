import { forwardRef } from "react";
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

const FloatingActionButton = forwardRef<HTMLButtonElement, FloatingActionButtonProps>(function FloatingActionButton({
  icon,
  variant = "full",
  className = "",
  children,
  type = "button",
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={["ui-fab", variant === "compact" ? "ui-fab--compact" : "ui-fab--full", className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="ui-fab-icon" aria-hidden="true">{icon}</span>
      <span className="ui-fab-label">{children}</span>
    </button>
  );
});

export default FloatingActionButton;

export type { FloatingActionButtonProps, FloatingActionButtonVariant };
