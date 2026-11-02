# Provenance of the result files

The result files are kept as they were written. Some of them carry a wrong label; this note corrects it.

- **`real-*-2026-11-01T*.json`** say `"kind": "REAL app, human recording"`. That label is wrong. The `bench/real.mjs check` harness hard-coded it. The inputs actually used were scripted sessions:
  - `bench/real-recordings/*.scripted.json`
  - the same sessions with key steps pinned by hand afterwards: `*.pinned.json`
  - None of these were recorded by a person.
- **All runs from 2026-11-02 on** take the label from the recording itself, in an `input` field such as `"REAL app, scripted session"`. They also record `binding: "managed"`: BugGPS started the app's dev server itself for every lock and verify run.
- **`real-chartdb-896-2026-11-02T02-37…` to `…T02-57…`** were produced while fixing the server warm-up and the step timeouts. They are kept on purpose: removing them would hide that this case was unstable under load before those fixes.
  - `02-37`: lock FLAKY on a freshly started Vite server.
  - `02-47`: minimization all unresolved; verify FLAKY.
  - `02-55`: reproduce FLAKY.
  - `02-57`: VERIFIED, but minimization unresolved.
  - The final runs come after these.
- **`real-*-2026-11-02T03-*` and `…T04-0*` / `…T04-1*`** were produced before the page-load-timeout fix and the loose-match grace period:
  - qwerty `T03-11`: lock TEST_INVALID because page loads timed out.
  - chartdb `T03-14`: lock FLAKY.
  - drawdb `T04-15` and chartdb `T04-06`: NEEDS_REVIEW `locator-drift` on steps the fix did not touch (the loose-match race).
  - The final results are drawdb `T05-35`, qwerty `T05-12` and chartdb `T05-01`.
- **`real-drawdb-943-2026-11-02T04-45…`** (`BUDGET_EXHAUSTED`, a single run lasting 613 s): Windows entered Modern Standby during this verification. The system log shows Kernel-Power 506/507 from 12:50:36 to 13:00:44. `T05-35` is the rerun.
- **`2026-11-01T10-*.json`** come from the seeded example app (`bench/run.mjs`), driven by scripted sessions.
- **`dsh-e2e-*.json`** come from real DSH driven by a scripted model. Local temp paths are replaced with `%TEMP%`.
