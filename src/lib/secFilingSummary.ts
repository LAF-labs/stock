export type SecFilingFacts = {
  insiderName?: string;
  saleShares?: number;
  saleValue?: number;
  purchaseShares?: number;
  purchaseValue?: number;
  acquiredShares?: number;
  disposedShares?: number;
  optionExerciseShares?: number;
  sharesOwnedAfter?: number;
  plannedSaleShares?: number;
  plannedSaleValue?: number;
  revenue?: number;
  netIncome?: number;
  fiscalPeriod?: string;
  periodEnd?: string;
  offeringAmount?: number;
  shares?: number;
  price?: number;
  holderName?: string;
  ownershipPercent?: number;
  currency?: string;
};

export type SecFilingSummaryInput = {
  formType: string;
  companyName?: string;
  ticker?: string;
  items?: string[] | string;
  facts?: SecFilingFacts;
};

export type SecFilingSummary = {
  category: string;
  importance: "low" | "medium" | "high";
  tags: string[];
  summaryKo: string;
};

const EIGHT_K_ITEMS: Record<string, string> = {
  "1.01": "중요 계약",
  "1.03": "파산/관리절차",
  "2.02": "실적 발표",
  "2.05": "구조조정 비용",
  "3.02": "비공개 증권 발행",
  "5.02": "임원·이사회 변경",
  "5.03": "정관 변경",
  "7.01": "IR/공정공시",
  "8.01": "기타 중요 이벤트",
  "9.01": "첨부자료",
};

export function summarizeSecFiling(input: SecFilingSummaryInput): SecFilingSummary {
  const form = normalizeForm(input.formType);
  const facts = input.facts || {};
  if (["3", "4", "5"].includes(form)) return summarizeOwnershipForm(form, facts);
  if (form === "8-K" || form === "8-K/A") return summarize8K(input.items, facts);
  if (form === "10-Q" || form === "10-Q/A" || form === "10-K" || form === "10-K/A") return summarizePeriodic(form, facts);
  if (form === "144") return summarizeForm144(facts);
  if (isBeneficialOwnershipForm(form)) return summarizeOwnershipStake(form, facts);
  if (isOfferingForm(form)) return summarizeOffering(facts);
  if (form === "6-K") {
    return makeSummary("foreign_report", "medium", ["해외기업", "수시공시"], "해외 상장사가 주요 자료를 SEC에 제출했어요. 세부 내용은 원문 확인이 필요해요.");
  }
  return makeSummary("other", "low", ["기타"], `${input.companyName || "회사"}가 SEC에 새 문서를 제출했어요. 자동 해석 신뢰도가 낮아 원문 확인이 필요해요.`);
}

function summarizeOwnershipForm(form: string, facts: SecFilingFacts): SecFilingSummary {
  const who = facts.insiderName ? `${facts.insiderName}이 ` : "임원/주요주주가 ";
  if (positive(facts.saleShares)) {
    const optionText = positive(facts.optionExerciseShares) ? `옵션 행사 ${formatShares(facts.optionExerciseShares)} 뒤 ` : "";
    const valueText = positive(facts.saleValue) ? ` 금액은 약 ${formatMoney(facts.saleValue, facts.currency)}입니다.` : "";
    const afterText = positive(facts.sharesOwnedAfter) ? ` 이후 보유량은 ${formatShares(facts.sharesOwnedAfter)}예요.` : "";
    return makeSummary("insider_transaction", "high", ["내부자", "매도"], `${who}${optionText}${formatShares(facts.saleShares)}를 매도했어요.${valueText}${afterText}`);
  }
  if (positive(facts.purchaseShares)) {
    const valueText = positive(facts.purchaseValue) ? ` 금액은 약 ${formatMoney(facts.purchaseValue, facts.currency)}입니다.` : "";
    return makeSummary("insider_transaction", "high", ["내부자", "매수"], `${who}${formatShares(facts.purchaseShares)}를 매수했어요.${valueText}`);
  }
  if (positive(facts.optionExerciseShares)) {
    return makeSummary("insider_transaction", "medium", ["내부자", "옵션"], `${who}옵션을 행사해 ${formatShares(facts.optionExerciseShares)}를 취득했어요. 시장에서 직접 산 건 아닐 수 있어요.`);
  }
  if (form === "3") return makeSummary("insider_transaction", "medium", ["내부자", "최초신고"], "임원/주요주주의 최초 보유 지분 신고예요. 새 내부자가 생겼거나 신고 의무가 시작됐다는 뜻이에요.");
  return makeSummary("insider_transaction", "medium", ["내부자"], "임원/주요주주의 보유 주식 변동 공시예요. 거래 성격은 원문 확인이 필요해요.");
}

function summarize8K(items: string[] | string | undefined, facts: SecFilingFacts): SecFilingSummary {
  const itemList = normalizeItems(items);
  const labels = itemList.map((item) => EIGHT_K_ITEMS[item]).filter(Boolean);
  if (itemList.includes("2.02")) {
    const numbers = financialNumbers(facts);
    return makeSummary("current_report", "high", ["8-K", "실적"], `${earningsLead(facts)}${numbers ? ` ${numbers}` : " 정식 분기보고서 전 실적 자료일 수 있어요."}`);
  }
  if (itemList.includes("5.02")) return makeSummary("current_report", "high", ["8-K", "임원변경"], "임원이나 이사회 구성 변경 공시예요. CEO/CFO급 변경이면 주가 영향이 커질 수 있어요.");
  if (itemList.includes("1.01")) return makeSummary("current_report", "high", ["8-K", "계약"], "중요 계약 체결 공시예요. 매출, 자금조달, 인수합병과 연결되는지 확인해야 해요.");
  if (itemList.includes("3.02")) return makeSummary("current_report", "high", ["8-K", "증권발행"], "비공개 증권 발행 공시예요. 새 주식 발행이면 기존 주주 지분이 희석될 수 있어요.");
  return makeSummary("current_report", "medium", ["8-K"], `회사가 중요 이벤트를 알린 8-K예요.${labels.length ? ` 항목: ${labels.slice(0, 3).join(", ")}.` : ""}`);
}

function summarizePeriodic(form: string, facts: SecFilingFacts): SecFilingSummary {
  const label = periodicLabel(form, facts);
  const numbers = financialNumbers(facts);
  return makeSummary("periodic_report", "high", [label], `${label}이 발표됐어요.${numbers ? ` ${numbers}` : " 매출, 이익, 현금흐름을 확인하는 핵심 공시예요."}`);
}

function summarizeForm144(facts: SecFilingFacts): SecFilingSummary {
  const shares = positive(facts.plannedSaleShares) ? `${formatShares(facts.plannedSaleShares)}를 ` : "";
  const value = positive(facts.plannedSaleValue) ? ` 예상 금액은 약 ${formatMoney(facts.plannedSaleValue, facts.currency)}예요.` : "";
  return makeSummary("planned_sale", "medium", ["매도계획"], `임원/대주주가 ${shares}팔 계획을 신고했어요. 실제 매도 완료 공시는 아니에요.${value}`);
}

function summarizeOwnershipStake(form: string, facts: SecFilingFacts): SecFilingSummary {
  const holder = facts.holderName ? `${facts.holderName}의 ` : "주요 투자자의 ";
  const pct = positive(facts.ownershipPercent) ? ` 지분율은 약 ${facts.ownershipPercent.toFixed(1)}%예요.` : "";
  return makeSummary("major_holder", "high", ["대량보유"], `${holder}대량보유 보고${form.endsWith("/A") ? " 정정" : ""}예요.${pct}`);
}

function summarizeOffering(facts: SecFilingFacts): SecFilingSummary {
  const amount = positive(facts.offeringAmount) ? ` 모집 규모는 약 ${formatMoney(facts.offeringAmount, facts.currency)}입니다.` : "";
  const shareText = positive(facts.shares) ? ` 발행 주식 수는 ${formatShares(facts.shares)}예요.` : "";
  const priceText = positive(facts.price) ? ` 공모가는 주당 ${formatUnitPrice(facts.price, facts.currency)}입니다.` : "";
  return makeSummary("offering", "high", ["증권발행"], `증권 발행/공모 관련 공시예요.${amount}${shareText}${priceText || ""}${shareText || amount ? "" : " 기존 주주 지분 희석 가능성을 봐야 해요."}`);
}

function financialNumbers(facts: SecFilingFacts): string {
  const parts: string[] = [];
  if (positive(facts.revenue)) parts.push(`매출 약 ${formatMoney(facts.revenue, facts.currency)}`);
  if (facts.netIncome !== undefined && Number.isFinite(facts.netIncome)) {
    parts.push(`${facts.netIncome < 0 ? "순손실" : "순이익"} 약 ${formatMoney(Math.abs(facts.netIncome), facts.currency)}`);
  }
  return parts.length ? `${parts.join(", ")}을 보고했어요.` : "";
}

function periodicLabel(form: string, facts: SecFilingFacts): string {
  if (form.startsWith("10-K")) return "연간 실적";
  const quarter = fiscalQuarterLabel(facts.fiscalPeriod);
  return quarter ? `${quarter} 실적` : "분기 실적";
}

function earningsLead(facts: SecFilingFacts): string {
  const quarter = fiscalQuarterLabel(facts.fiscalPeriod);
  return quarter ? `${quarter} 실적이 발표됐어요.` : "실적이 발표됐어요.";
}

function fiscalQuarterLabel(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^Q([1-4])$/i);
  return match ? `${match[1]}분기` : undefined;
}

function makeSummary(category: string, importance: SecFilingSummary["importance"], tags: string[], summaryKo: string): SecFilingSummary {
  return { category, importance, tags, summaryKo: compactSummary(summaryKo) };
}

function compactSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeItems(value: string[] | string | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value || "";
  return raw
    .split(/[,\s]+/)
    .map((item) => item.replace(/^ITEM\s*/i, "").trim())
    .filter(Boolean);
}

function isOfferingForm(form: string): boolean {
  return /^(S|F)-[13]\b/.test(form) || form.startsWith("424B") || form === "POS AM";
}

function isBeneficialOwnershipForm(form: string): boolean {
  return form.startsWith("SC 13D")
    || form.startsWith("SC 13G")
    || form.startsWith("SCHEDULE 13D")
    || form.startsWith("SCHEDULE 13G");
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatShares(value: number | undefined): string {
  return `${Math.round(value || 0).toLocaleString("en-US")}주`;
}

export function formatSecCompactMoney(value: number | undefined, currency = "USD"): string {
  return formatMoney(value, currency);
}

function formatMoney(value: number | undefined, currency = "USD"): string {
  const amount = Math.abs(value || 0);
  const prefix = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  if (amount >= 1_000_000_000) return `${prefix}${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${prefix}${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${prefix}${(amount / 1_000).toFixed(1)}K`;
  return `${prefix}${amount.toFixed(0)}`;
}

function formatUnitPrice(value: number | undefined, currency = "USD"): string {
  const amount = Math.abs(value || 0);
  if (amount >= 1_000) return formatMoney(amount, currency);
  const prefix = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${prefix}${amount.toFixed(2).replace(/\.00$/, "")}`;
}
