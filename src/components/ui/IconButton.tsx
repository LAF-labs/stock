import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "plain" | "soft" | "solid";
type IconButtonSize = "sm" | "md" | "lg";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  "aria-label": string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

export default function IconButton({
  icon,
  variant = "soft",
  size = "md",
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={["ui-icon-button", `ui-icon-button--${variant}`, `ui-icon-button--${size}`, className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon}
    </button>
  );
}

export type { IconButtonProps, IconButtonSize, IconButtonVariant };
