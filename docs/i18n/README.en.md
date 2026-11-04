# BugGPS · dsh-bug-gps

[简体中文](../../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

**Record the bug. Verify the fix against the original expectation.**

BugGPS is a DeepSeek Harness (DSH) plugin for a browser problem you can already describe or reproduce. Capture the actions and the intended result, establish a repeatable failure, then verify the changed code with the same checks and a fresh baseline control.

> The commands below install a pinned Git revision. Use the npm path after the requested version is published. Check [release status](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4). Compatibility is limited to DSH **0.2.1-rc.5**, `headless` / `web`.

```bash
dsh plugin --profile web add 'git+https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git#345b2744ffac9fd5d70fa0a31c3060b67b5918b2'
dsh --profile web --dump-config
```

This example uses `web`; use `headless` in both commands for a headless instance. Confirm the configuration layer, restart that instance, then call `buggps_status` in the target Git project. Desktop acceptance is separate.

[Install and remove (Chinese/English)](../installation.md) · [Historical evidence (pinned source)](../verification/1.0.0/README.md). Each record identifies its own source and scope; current checks are tracked in the release checklist.

![BugGPS](../media/buggps-demo.gif)

The demo uses scripted actions on the included seeded example and preset changes. It shows actual page and tool output with edited keyframes; its duration is not task runtime. The result cards, cursor and captions are presentation overlays.

## Try the included example

Requires Node.js ≥20, Git, and an installed Microsoft Edge or Google Chrome. The recorded Windows checks use Node 24.22.0 and Edge 156; this does not establish support for every browser or operating system.

```bash
git clone --branch release/v1.0.0-ready --single-branch https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
npm ci
node bin/buggps.js demo ../buggps-demo
node bin/buggps.js doctor --repo ../buggps-demo
```

The demo command creates a separate Git repository and prints the next steps. Start its development server, open the project in DSH, and use BugGPS to capture the problem and its intended result. `doctor` checks the runtime, browser, commands, configuration and port. Existing drafts can be locked without a new interactive capture.

## Load the plugin in DSH

Loading the plugin through `dsh plugin` also requires **pnpm ≥10** on PATH.

```bash
dsh plugin --profile PROFILE add "/absolute/path/to/dsh-bug-gps"
dsh --profile PROFILE --dump-config
```

Replace `PROFILE` with the profile your DSH instance actually uses, and the path with your absolute checkout path. Restart that instance and call `buggps_status` in the target project. A configuration entry alone does not prove the tools loaded.

Desktop and command-line instances may use different profiles. Installing into `web` does not establish desktop installation. Check the desktop's bundled DSH version and actual profile before using its plugin manager. The official rc.5 CLI workflow has been exercised; the desktop installation path has not yet completed separate acceptance.

## How it works

1. **Record:** actions, browser settings and explicit expectations. Optional checkpoints preserve the situation before the symptom; key steps survive shortening.
2. **Lock:** start the app through the saved `serve` command and reproduce the same failure three times by default. Keep the case, baseline and failure evidence.
3. **Repair:** DSH edits application source using your existing configuration.
4. **Verify:** replay the complete recording three times by default, retain the original checks, and reproduce the locked failure in an independent baseline worktree before returning `VERIFIED`.

## Read the result

| Result | Meaning |
|---|---|
| `VERIFIED` | The recorded checks pass and a fresh baseline reproduces the locked failure. |
| `PASSED_UNBOUND` | Checks pass on an external server; the running code cannot be bound to this patch. |
| `NEEDS_REVIEW` | Checks pass with weaker evidence: disabled trigger, absence-only checks, locator drift, evaluator change or failed baseline control. |
| `STILL_FAILING` | The original failure remains. |
| `DIFFERENT_FAILURE` | The scenario still fails, with a different symptom or unmet checkpoint. |
| `TEST_INVALID / ENV_BLOCKED` | Unusable test definition or blocked environment; neither is a reproduced bug. |
| `FLAKY / STALE / CASE_TAMPERED` | Inconsistent runs, code changed during verification, or modified locked evidence. |
| `NO_CODE_CHANGE` | Baseline unchanged. Continue a requested repair; verification-only requests report the unchanged code. |
| `BUDGET_EXHAUSTED / ABORTED` | Budget exhausted or task cancelled; the evidence is incomplete. |

`buggps_status` lists the latest completed valid run. A historical result applies only when the code, case, lock and evaluator still match; `not_current_reasons` explains mismatches. `NO_CODE_CHANGE` retains that verdict and does not confirm a fix.

Tool text previews are limited to 12,000 characters, with verdicts, evidence references and next actions first. When `output_preview: abbreviated` appears, read the referenced draft, case, run record or patch. Complete structured results and checks remain unchanged; do not reconstruct tests or adopt patches from abbreviated text.

## Scope and limits

- A verified result covers the recorded scenario. It does not prove the application has no other bugs.
- Use resettable frontend state. Warm-up replays actions once before counted trials; server-side mutations are outside the accepted scope.
- By default the final checks are sampled for 1,000 ms at a target interval of 50 ms. Sampling gaps and later changes remain outside that observation window.
- Shortening returns a confirmed shorter path within a budget. The complete recording remains authoritative; a global minimum and causal necessity are not promised.
- Snapshots follow Git and exclude ignored dependencies and configuration. Baseline controls record shared root dependencies and copied environment inputs separately. A worktree is not a security sandbox.
- Secret-like inputs store environment references. Heuristic detection can miss sensitive content; inspect artifacts before sharing.
- Locked definitions and provenance are checked for consistency. Shell protection is best effort; hashes are not an unforgeable proof.

[Configuration, full verdicts and detailed limitations](../../README.md)

## Evidence and feedback

The test suite, installable-package check and fixed twelve-case regression set have separate records. Historical cases informed improvements and are an expanded regression set, not a blind holdout. Failures remain in the denominator.

[Case guide](../../bench/RECORDING-GUIDE.md) · [Run records](../../bench/results) · [Browser regressions](../../test/counterexamples.test.js) · [Report a problem](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/new)

Include the DSH version, operating system, expected behavior, exact verdict and a safe reproduction. Remove credentials and private data before sharing.

If BugGPS helped you verify a repair, a Star helps others discover it.

[Host dependency compatibility and package checks](../host-compatibility.md)

[Plugin directories and marketplace integration](../distribution.md) · [Catalog entry preparation](../../distribution/README.md)

MIT · [LICENSE](../../LICENSE)


[Reproduce the external ChartDB repair](../../bench/repairs/chartdb-dbml-index/README.md) · [DSH rc.5](../../bench/results/account-project-chartdb-dbml-index-2026-11-03.json) · [ChartDB fixture: AGPLv3](../../bench/repairs/chartdb-dbml-index/LICENSE)
