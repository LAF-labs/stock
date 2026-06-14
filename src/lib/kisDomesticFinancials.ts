export type KisDomesticFinanceEndpoint = {
  key: string;
  path: string;
  trId: string;
};

export type KisDomesticFinancialRaw = Record<string, Array<Record<string, unknown>>>;

export const KIS_DOMESTIC_SCORE_MARKET_DIV_CODE = "J";

export const KIS_DOMESTIC_FINANCE_ENDPOINTS: KisDomesticFinanceEndpoint[] = [
  { key: "balance_sheet", path: "/uapi/domestic-stock/v1/finance/balance-sheet", trId: "FHKST66430100" },
  { key: "income_statement", path: "/uapi/domestic-stock/v1/finance/income-statement", trId: "FHKST66430200" },
  { key: "financial_ratio", path: "/uapi/domestic-stock/v1/finance/financial-ratio", trId: "FHKST66430300" },
  { key: "profit_ratio", path: "/uapi/domestic-stock/v1/finance/profit-ratio", trId: "FHKST66430400" },
  { key: "other_major_ratios", path: "/uapi/domestic-stock/v1/finance/other-major-ratios", trId: "FHKST66430500" },
  { key: "stability_ratio", path: "/uapi/domestic-stock/v1/finance/stability-ratio", trId: "FHKST66430600" },
  { key: "growth_ratio", path: "/uapi/domestic-stock/v1/finance/growth-ratio", trId: "FHKST66430800" },
];

export function kisDomesticPeriodType(period: string): string {
  return period.trim() === "1" ? "quarterly" : "annual";
}

export function normalizeKisDomesticFinancials(input: { raw?: unknown } | KisDomesticFinancialRaw): Record<string, number | string> {
  const raw = recordValue("raw" in input ? input.raw : input) || {};
  const balance = latestRow(raw, "balance_sheet");
  const income = latestRow(raw, "income_statement");
  const financial = latestRow(raw, "financial_ratio");
  const domesticPrice = firstRow(raw, "domestic_price");
  const profit = latestRow(raw, "profit_ratio");
  const other = latestRow(raw, "other_major_ratios");
  const stability = latestRow(raw, "stability_ratio");
  const growth = latestRow(raw, "growth_ratio");

  const revenue = firstPresent(income.sale_account);
  const operatingIncome = firstPresent(income.bsop_prti);
  const netIncome = firstPresent(income.thtr_ntin);
  const totalAssets = firstPresent(balance.total_aset);
  const totalLiabilities = firstPresent(balance.total_lblt);
  const totalEquity = firstPresent(balance.total_cptl);
  const profitMargin = firstRatio(profit.sale_ntin_rate) ?? divide(netIncome, revenue);
  const period = [
    financial.stac_yymm,
    income.stac_yymm,
    balance.stac_yymm,
    profit.stac_yymm,
    stability.stac_yymm,
    growth.stac_yymm,
    other.stac_yymm,
  ].map((value) => stringValue(value)).find(Boolean);

  return compactFiniteMapping({
    period,
    periodEnded: period,
    totalRevenue: revenue,
    operatingIncome,
    netIncome,
    totalAssets,
    currentAssets: firstPresent(balance.cras),
    totalLiabilities,
    currentLiabilities: firstPresent(balance.flow_lblt),
    totalEquity,
    operatingMargins: divide(operatingIncome, revenue),
    profitMargins: profitMargin,
    grossMargins: firstRatio(profit.sale_totl_rate),
    returnOnEquity: firstRatio(financial.roe_val, profit.self_cptl_ntin_inrt),
    revenueGrowth: firstRatio(financial.grs, growth.grs),
    operatingIncomeGrowth: firstRatio(financial.bsop_prfi_inrt, growth.bsop_prfi_inrt),
    earningsGrowth: firstRatio(financial.ntin_inrt),
    equityGrowth: firstRatio(growth.equt_inrt),
    assetGrowth: firstRatio(growth.totl_aset_inrt),
    eps: firstPresent(domesticPrice.eps, financial.eps),
    bps: firstPresent(domesticPrice.bps, financial.bps),
    salesPerShare: firstPresent(financial.sps),
    trailingPE: firstPresent(domesticPrice.per),
    priceToBook: firstPresent(domesticPrice.pbr),
    listedShares: firstPresent(domesticPrice.lstn_stcn),
    marketCap: domesticMarketCap(domesticPrice),
    reserveRatio: ratioAsReported(financial.rsrv_rate),
    debtToEquity: ratioAsReported(stability.lblt_rate ?? financial.lblt_rate),
    borrowingsDependency: ratioAsReported(stability.bram_depn),
    currentRatio: percentRatioToMultiple(stability.crnt_rate),
    quickRatio: percentRatioToMultiple(stability.quck_rate),
    payoutRatio: firstRatio(other.payout_rate),
    eva: firstPresent(other.eva),
    ebitda: firstPresent(other.ebitda),
    evToEbitda: firstPresent(other.ev_ebitda),
  });
}

function latestRow(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const rows = rowList(raw[key]);
  if (!rows.length) return {};
  return rows.reduce((latest, row) => String(row.stac_yymm || "") > String(latest.stac_yymm || "") ? row : latest, rows[0]!);
}

function firstRow(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  return rowList(raw[key])[0] || {};
}

function domesticMarketCap(domesticPrice: Record<string, unknown>): number | undefined {
  const htsMarketCapEok = firstPresent(domesticPrice.hts_avls, domesticPrice.stck_avls);
  if (htsMarketCapEok !== undefined) return htsMarketCapEok * 100_000_000;
  const latestPrice = firstPresent(domesticPrice.stck_prpr);
  const listedShares = firstPresent(domesticPrice.lstn_stcn);
  return latestPrice !== undefined && listedShares !== undefined ? latestPrice * listedShares : undefined;
}

function rowList(value: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function compactFiniteMapping(values: Record<string, unknown>): Record<string, number | string> {
  const compacted: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) {
      compacted[key] = value.trim();
      continue;
    }
    const finite = finiteNumber(value);
    if (finite !== undefined) compacted[key] = finite;
  }
  return compacted;
}

function firstPresent(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asFloat(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function firstRatio(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = pctToRatio(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function pctToRatio(value: unknown): number | undefined {
  const parsed = asFloat(value);
  return parsed === undefined ? undefined : parsed / 100;
}

function percentRatioToMultiple(value: unknown): number | undefined {
  const parsed = asFloat(value);
  if (parsed === undefined) return undefined;
  return Math.abs(parsed) > 10 ? parsed / 100 : parsed;
}

function ratioAsReported(value: unknown): number | undefined {
  return asFloat(value);
}

function divide(numerator: unknown, denominator: unknown): number | undefined {
  const parsedNumerator = asFloat(numerator);
  const parsedDenominator = asFloat(denominator);
  if (parsedNumerator === undefined || !parsedDenominator) return undefined;
  return parsedNumerator / parsedDenominator;
}

function asFloat(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
}
