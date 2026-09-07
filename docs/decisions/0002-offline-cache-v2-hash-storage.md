# 0002 — Offline cache v2: content-addressed storage

- Status: Accepted
- Date: (2026; recorded retroactively 2026-09-07)

## Context

The v1 offline cache keyed audio files by song id under a single flat directory
and stored one index. Problems: the same file re-downloaded per user wasted
disk; deleting a song for one user could orphan or wrongly remove a file another
user shared; the index bloated and corrupted on large "download everything"
runs; cover art was duplicated per track.

## Decision

`offlineCacheService` v2 (`src/services/offlineCacheService.ts`):

- **Audio and cover-art files are content-addressed** — stored at
  `audio/<hash>/…` where `hash = md5(normalizedServerUrl + ':' + songId)` (see
  `utils/cacheHelpers.ts`; server URL is normalized so `http://s:4533` and
  `http://s:4533/` collide intentionally).
- **One shared `registry.json`** holds `audioFiles` / `coverArtFiles` /
  `coverArtIdMap` with a `refCount` + `users[]` per file, plus a `totalSize`.
- **Per-user `cache_index.json`** maps that user's song ids → registry hashes,
  with its own `totalSize`.
- `totalSize` accounting subtracts the previous entry's `fileSize` before adding
  the new one, so a re-register (orphan recovery, quality change) never inflates
  the stat. Index/registry writes are **debounced 500 ms**; `flushAll()` forces
  a write at batch end.

## Consequences

- Shared files stored once; `removeFromCache` only deletes bytes when
  `refCount` hits 0.
- Size stats are correct across re-registration — pinned by
  `offlineCacheService.test.ts`.
- Migration from v1 runs once on init (`checkAndMigrateV1Cache`).
- The debounce means a hard crash mid-batch can lose the last <500 ms of index
  writes — recovered by the startup reconcile, see
  [0003](0003-download-orphan-reconciliation.md).
