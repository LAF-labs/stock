"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { symbolRef } from "@/components/stockCompareHelpers";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

export default function AppGlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function selectSymbol(item: SymbolSearchItem) {
    setValue("");
    router.push(`/?ticker=${encodeURIComponent(symbolRef(item))}`);
  }

  return (
    <SymbolAutocomplete
      id="app-global-ticker"
      value={value}
      onValueChange={setValue}
      onSelect={selectSymbol}
      placeholder="종목명·티커 검색"
      buttonLabel="검색"
      label="국내·미국 주식 전역 검색"
      className="stock-search-form app-global-search"
      formAction="/"
      inputName="ticker"
    />
  );
}
