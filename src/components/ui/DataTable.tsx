import type { HTMLAttributes } from "react";

type DataTableProps = Omit<HTMLAttributes<HTMLDivElement>, "role"> & {
  role?: "table" | "list";
  density?: "comfortable" | "compact";
};

export default function DataTable({
  role,
  density = "comfortable",
  className = "",
  ...props
}: DataTableProps) {
  const roleProps = role ? { role } : {};

  return <div {...roleProps} className={["ui-data-table", `ui-data-table--${density}`, className].filter(Boolean).join(" ")} {...props} />;
}

export type { DataTableProps };
