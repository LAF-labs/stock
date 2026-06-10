import type { StockDisplaySnapshot, StockDisplayView } from "@/lib/stockDisplayTypes";
import { normalizeTickerRef } from "@/lib/tickerRef";

declare global {
  var __stockDisplaySnapshotMemoryStore: Map<string, StockDisplaySnapshot> | undefined;
}

const memoryStore = (globalThis.__stockDisplaySnapshotMemoryStore ??= new Map<string, StockDisplaySnapshot>());

export function displaySnapshotKey(tickerRef: string, view: StockDisplayView): string {
  return `${view}:${normalizeTickerRef(tickerRef)}`;
}

export function readMemoryDisplaySnapshot(tickerRef: string, view: StockDisplayView): StockDisplaySnapshot | undefined {
  const snapshot = memoryStore.get(displaySnapshotKey(tickerRef, view));
  return snapshot ? cloneSnapshot(snapshot) : undefined;
}

export function writeMemoryDisplaySnapshot(snapshot: StockDisplaySnapshot): void {
  const normalized: StockDisplaySnapshot = {
    ...snapshot,
    ticker: normalizeTickerRef(snapshot.ticker),
    parts: { ...snapshot.parts },
    completion: {
      requiredParts: [...snapshot.completion.requiredParts],
      presentParts: [...snapshot.completion.presentParts],
      missingParts: [...snapshot.completion.missingParts],
      recoveringParts: [...snapshot.completion.recoveringParts],
      unavailableParts: snapshot.completion.unavailableParts.map((item) => ({ ...item })),
    },
  };
  memoryStore.set(displaySnapshotKey(normalized.ticker, normalized.view), normalized);
}

function cloneSnapshot(snapshot: StockDisplaySnapshot): StockDisplaySnapshot {
  return {
    ...snapshot,
    parts: { ...snapshot.parts },
    completion: {
      requiredParts: [...snapshot.completion.requiredParts],
      presentParts: [...snapshot.completion.presentParts],
      missingParts: [...snapshot.completion.missingParts],
      recoveringParts: [...snapshot.completion.recoveringParts],
      unavailableParts: snapshot.completion.unavailableParts.map((item) => ({ ...item })),
    },
  };
}

export const stockDisplaySnapshotStoreTestHooks = {
  resetMemory() {
    memoryStore.clear();
  },
};
