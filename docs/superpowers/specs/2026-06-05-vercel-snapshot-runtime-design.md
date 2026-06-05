# Vercel Snapshot Runtime Design

## Goal

Run the public Next.js app on Vercel + Supabase without executing Python subprocess collectors from user request handlers.

## Architecture

The public app reads from process memory first, then Supabase snapshot tables. When `STOCK_DATA_RUNTIME=snapshot` or `VERCEL=1`, score and quote APIs do not invoke Python collector fallback and do not schedule Python background refreshes. Missing snapshots return a stable `snapshot_unavailable` 503 payload so operations can distinguish ingestion gaps from app crashes.

Python remains available for local development, Docker/VM deployments, smoke checks, and scheduled snapshot publishing. The new publisher script runs outside Vercel, fetches quote/detail/compare payloads with the existing collector, and upserts them into `stock_quote_snapshots` and `stock_score_snapshots`.

## Data Flow

1. GitHub Actions, local admin, or another worker runs `scripts/publish_stock_snapshots.py`.
2. The script fetches quote and score payloads, builds Supabase rows with `fetched_at` and `expires_at`, and upserts with `SUPABASE_SERVICE_ROLE_KEY`.
3. Vercel handles user reads through Next API routes.
4. API routes serve memory/Supabase snapshots; if missing, they return `snapshot_unavailable`.

## Error Handling

Snapshot misses use:

```json
{
  "ok": false,
  "error": "snapshot_unavailable",
  "message": "Stock data snapshot is not available yet.",
  "kind": "score",
  "ticker": "US:KO",
  "view": "detail",
  "reason": "snapshot_miss"
}
```

Manual refresh in snapshot mode uses `reason: "refresh_background_only"` because refresh must be performed by the scheduled publisher, not a Vercel request.

## Runtime Modes

- `STOCK_DATA_RUNTIME=snapshot`: Supabase-only public hot path.
- `STOCK_DATA_RUNTIME=python`: local/Docker collector fallback.
- unset on Vercel: defaults to `snapshot`.
- unset elsewhere: defaults to `python` for developer convenience.

## Verification

Tests cover runtime mode selection, public error payloads, and cache behavior that avoids Python collector calls in snapshot mode. Python tests cover publisher row construction and ticker normalization.
