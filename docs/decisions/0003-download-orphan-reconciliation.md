# 0003 — Native download orphan reconciliation

- Status: Accepted
- Date: (2026; planner extracted + recorded 2026-09-07)

## Context

On Android a bulk download runs entirely on a native `DownloadService` thread so
it survives WebView throttling/OOM. Each finished song is delivered to JS as a
`songDownloaded` event, which registers it in the cache index. If the renderer
process dies mid-batch (extended screen-off OOM), those events are lost: the
file is on disk but absent from the index — an *orphan*. iOS has the same
problem when WKWebView is suspended during a background `URLSession` batch.

## Decision

- Before a native batch starts, `downloadManagerService` persists a
  **pending-batch map** (`song id → { song, quality, artistId, … }`) to
  `localStorage` (`savePendingBatch`, merge-not-overwrite so several crashed
  batches stack).
- The native side writes a **completion log** (UserDefaults / equivalent) of
  every file it actually wrote.
- On the next launch, `reconcileOrphans()` reads the completion log, and for
  each entry that is (a) not already cached and (b) present in the pending-batch
  map, re-registers it in the cache index — no re-download.
- The decision logic is pure and shared between the Android and iOS paths:
  `src/services/downloadReconciler.ts` (`planOrphanReconciliation`,
  `mergePendingBatch`, `parsePendingBatch`, `pendingBatchFromQueueArray`),
  covered by `downloadReconciler.test.ts`. The service only does the I/O
  (read log, call `registerNativeDownload`, clear log).

## Consequences

- A killed renderer mid-batch costs a one-time startup reconcile, not lost
  downloads.
- The completion log is cleared after a successful reconcile so it can't
  double-register on a later launch.
- The in-flight `songDownloaded`/`songFailed` handlers are idempotent
  (`if (item.status === 'completed') return`) so a duplicated native event can't
  double-count either.
