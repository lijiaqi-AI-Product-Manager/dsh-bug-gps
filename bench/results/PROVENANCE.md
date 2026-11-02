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
- **`live-provider-*.json`** run the official DSH account provider on the seeded example, with scripted browser input. They record actual tool outcomes, protected-file consistency and usage when supplied. They do not establish an independent repair of an external historical project. Raw events remain private; currency cost is unknown when the provider does not supply it.
- **`holdout-*.json`** use the fixed `browser-state-12` list. Cases that informed execution changes are an expanded regression set, not a blind holdout. A batch result includes only that invocation; the denominator stays 12.
  - `T15-46`: four fixtures were rejected because their historical build had generated tracked declarations. Those failures are retained. Later runs explicitly record these declarations in the baseline.
  - `T15-49`: four Vue cases complete the full-path checks. Three raw recordings replay; the favorite button needs a declared locator before locking. These records do not yet include comparison of a shortened path against the upstream fix.
  - `T16-05`: the drawdb export path does not reproduce the reported filename issue; presentation mode requires locator review; the first Save As check contains incorrect literal spaces in the expected breadcrumb. None of these results is a successful fix verdict.
  - `T17-41`: drawdb presentation mode runs with evaluator v4. Both disappearing targets retain their own earlier exact candidates. The candidate passes 3/3 but remains `NEEDS_REVIEW`: the database-selection action also resolves through an unscoped text candidate. [The visibility evidence](visibility-evidence-d8b8602-drawdb-1037.json) preserves the relevant profiles and history; this is not a verified repair verdict. Minimization exhausts its budget without a shorter confirmed path (7 to 7).
  - `T20-01`: drawdb presentation mode reuses the unchanged seven-step scripted input with evaluator v6 at `a46e605`. The dialog-scoped database selection is retained throughout the negative control, upstream patch and fresh baseline. The upstream patch is `VERIFIED` (3/3 passing); the baseline matches the locked failure (3/3), and the unrelated patch remains `STILL_FAILING` (3/3). The confirmed six-step path also passes on the upstream fix (3/3), preserving the distinction from the original failure. This is replay of an existing upstream repair, with zero model calls. Minimization reports `BUDGET_EXHAUSTED`: its configured 30,000 ms budget took 56,796 ms, so this run does not establish enforcement of an overall time limit. The new record and the earlier review outcomes are all retained.
  - `T21-00`: the same drawdb scripted input runs at `0d58171` with the shared execution deadline. The configured 30,000 ms minimization budget returns in 30,555 ms including context cleanup, as `BUDGET_EXHAUSTED`; no shortened path has completed confirmation, so all seven original steps are retained. The earlier six-step result is not carried over as a new success. The full path still verifies the upstream patch (3/3 passing), the fresh baseline matches the locked failure (3/3), the unrelated patch remains `STILL_FAILING` (3/3), and protected inputs are unchanged. This does not measure the total setup/server/verification duration as a 30-second task.
  - `holdout-recordings/v2/drawdb-1066.json` is a new capture from the original buggy commit. Its pre-operation title is established before Save As and must remain identical afterwards, together with creation of the Copy link. The original input, old lock and previous failed result remain intact.
  - ChartDB uses an explicit fixture entry to suppress only its timed promotional dialog; the entry fingerprint and adaptation appear in each relevant result. This does not establish an installation experience without fixture setup.
  - Incomplete captures are retained as `TEST_INVALID`, with their recorded steps and failure phase. They remain in the denominator and do not reach patch verification.
- **`regression-summary-*.json`** select the latest chronological attempt per case and list every retained attempt. They never choose the best outcome or merge an earlier success into a later failed run.
