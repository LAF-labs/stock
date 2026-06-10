"use client";

import { useEffect, useRef } from "react";

export type PendingRetryTarget = {
  message?: string;
  retryAfterSeconds?: number;
};

export function technicalPendingRetryDelayMs(
  retryAfterSeconds: number | undefined,
  attempt: number,
  random: () => number = Math.random
): number {
  void retryAfterSeconds;
  const retrySecondsByAttempt = [1, 2, 3, 5, 8, 13, 21, 34, 55, 60];
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const baseSeconds = retrySecondsByAttempt[Math.min(safeAttempt, retrySecondsByAttempt.length - 1)] ?? 15;
  const jitter = 0.85 + Math.max(0, Math.min(1, random())) * 0.3;
  return Math.round(baseSeconds * 1000 * jitter);
}

export function pendingRetryDelayMs(
  retryAfterSeconds: number | undefined,
  attempt = 0,
  random: () => number = Math.random
): number {
  return technicalPendingRetryDelayMs(retryAfterSeconds, attempt, random);
}

export function canSchedulePendingRetry({
  attempt,
  maxAttempts,
  visibilityState,
}: {
  attempt: number;
  maxAttempts: number;
  visibilityState: DocumentVisibilityState;
}): boolean {
  return attempt < maxAttempts && visibilityState !== "hidden";
}

export function usePendingRetry({
  pending,
  retryKey,
  onRetry,
  maxAttempts = 24,
  delayMs = (target, attempt) => pendingRetryDelayMs(target.retryAfterSeconds, attempt),
}: {
  pending: PendingRetryTarget | undefined;
  retryKey: string;
  onRetry: () => void;
  maxAttempts?: number;
  delayMs?: (pending: PendingRetryTarget, attempt: number) => number;
}) {
  const retryRef = useRef(onRetry);
  const delayRef = useRef(delayMs);
  const attemptRef = useRef({ key: "", attempts: 0 });

  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);

  useEffect(() => {
    delayRef.current = delayMs;
  }, [delayMs]);

  useEffect(() => {
    if (!pending) return;
    if (attemptRef.current.key !== retryKey) {
      attemptRef.current = { key: retryKey, attempts: 0 };
    }

    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const schedule = () => {
      clear();
      if (!canSchedulePendingRetry({ attempt: attemptRef.current.attempts, maxAttempts, visibilityState: document.visibilityState })) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!canSchedulePendingRetry({ attempt: attemptRef.current.attempts, maxAttempts, visibilityState: document.visibilityState })) return;
        attemptRef.current.attempts += 1;
        retryRef.current();
      }, delayRef.current(pending, attemptRef.current.attempts));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clear();
      } else {
        schedule();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pending, retryKey, maxAttempts]);
}
