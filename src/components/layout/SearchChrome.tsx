import type { ReactNode, RefCallback } from "react";

type SearchChromeFrameProps = {
  className: string;
  frameRef?: RefCallback<HTMLElement>;
  children: ReactNode;
};

export default function SearchChromeFrame({ className, frameRef, children }: SearchChromeFrameProps) {
  return (
    <section ref={frameRef} className={["search-chrome-frame", className].filter(Boolean).join(" ")}>
      {children}
    </section>
  );
}
