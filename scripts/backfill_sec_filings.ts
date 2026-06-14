import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import {
  backfillSecFilings,
  secFilingBackfillRunnerTestHooks,
  type SecFilingBackfillOptions,
} from "@/lib/secFilingBackfillRunner";

type Options = SecFilingBackfillOptions & {
  selfTest: boolean;
};

export function parseOptions(argv: string[]): Options {
  const options: Options = {
    allUs: false,
    tickers: [],
    since: oneYearAgo(),
    limitTickers: 0,
    maxFilingsPerTicker: 80,
    fetchDocLimit: 200,
    json: false,
    dryRun: false,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--all-us") options.allUs = true;
    else if (arg === "--ticker") options.tickers.push(next());
    else if (arg === "--tickers") options.tickers.push(...next().split(","));
    else if (arg === "--since") options.since = next();
    else if (arg === "--limit-tickers") options.limitTickers = positiveInt(next(), 0);
    else if (arg === "--max-filings-per-ticker") options.maxFilingsPerTicker = positiveInt(next(), 80);
    else if (arg === "--fetch-doc-limit") options.fetchDocLimit = positiveInt(next(), 200);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--self-test") options.selfTest = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

async function main() {
  loadCliEnvFiles();
  const options = parseOptions(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    console.log("backfill_sec_filings self-test OK");
    return;
  }
  const result = await backfillSecFilings(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`rows=${result.rows} tickers=${result.tickers} skipped=${result.skipped} dry_run=${result.dry_run}`);
}

function selfTest() {
  const facts = secFilingBackfillRunnerTestHooks.extractOwnershipFacts(`
    <rptOwnerName>Jane Doe</rptOwnerName>
    <nonDerivativeTransaction><transactionCode><value>S</value></transactionCode><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>12.5</value></transactionPricePerShare><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></nonDerivativeTransaction>
  `);
  assert.equal(facts.insiderName, "Jane Doe");
  assert.equal(facts.saleShares, 1000);
  assert.equal(facts.saleValue, 12500);

  const planned = secFilingBackfillRunnerTestHooks.extractPlannedSaleFacts(
    "<noOfUnitsSold>50000</noOfUnitsSold><aggregateMarketValue>15551085.00</aggregateMarketValue>"
  );
  assert.equal(planned.plannedSaleShares, 50000);
  assert.equal(planned.plannedSaleValue, 15551085);
}

function loadCliEnvFiles() {
  for (const name of [".env.local", ".env.supabase.local", ".env.vercel.local"]) {
    let text = "";
    try {
      text = readFileSync(resolve(process.cwd(), name), "utf8");
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [rawKey, ...rest] = line.split("=");
      const key = rawKey.trim();
      const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function oneYearAgo(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

if (process.argv[1]?.endsWith("backfill_sec_filings.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
