# Spike S1 — BugGPS on the real DeepSeek Harness (DSH)

**Verdict: PASS. The plugin layer works as planned, with four design constraints listed below.** A minimal external bundle (`dsh-bug-gps`) installs with `dsh plugin add`, both as a linked checkout and as an `npm pack` tarball. It loads in the real `dsh` CLI and registers a tool, a background job, a skill and a write-protection policy. A real headless agent loop then drives all of it end to end. The four constraints:

1. If the bundle is missing or skipped, DSH only warns on stderr and keeps running with exit 0. BugGPS has to check for itself that its guard is loaded.
2. `job_kill` only calls your `cancel()`. Killing the whole process tree is the producer's job, and `ctx.subprocess` is the way to do it.
3. A guard on file-tool paths works. A guard on shell commands can be bypassed by trivial obfuscation, as expected.
4. On Windows, a deep `DSH_HOME` path breaks `dsh plugin` (`ENAMETOOLONG`).

| | |
|---|---|
| DSH version | `@deepseek-ai/dsh@0.2.1-rc.5` (npm `latest`), `dsh --version` → `0.2.1-rc.5` |
| Machine | Windows 11 (10.0.26300), PowerShell 5.1, Node v24.22.0, npm 11.19.1, pnpm 10.34.9 (installed locally, see B3) |
| Install | **local only**: `spikes/s1-dsh/dsh/` (`npm install @deepseek-ai/dsh@0.2.1-rc.5`). No global install. |
| DSH_HOME | isolated: `spikes/s1-dsh/dsh-home` (mapped to `Q:\dsh-home`, see B4). The user's real `~/.dsh` was not used. |
| Model | **No real model.** A scripted Messages-API SSE mock (`mock/server.mjs`) is reached through `DEEPSEEK_BASE_URL`. The real `dsh --profile headless` agent loop, tool pipeline, jobs, skills and policies all ran unmodified. |

## Results

| # | Check | Result |
|---|---|---|
| 1 | `buggps_ping` registered via `defineTool`, visible to model, runs, typed object output | **PASS** |
| 2a | `buggps_sleep` background job via `ctx.jobs.start`, `job_kill` cancels it | **PASS** |
| 2b | `job_kill` kills the **whole** child tree | **PASS only if the producer uses `ctx.subprocess`** (or `taskkill /T`). Raw `child.kill()` **leaks** a detached grandchild |
| 2c | `exec.signal` cancellation (foreground) | **PASS** (via base bundle's timeout policy + `timeoutMs`) |
| 3 | `ctx.skills.register` → appears in catalog; body loads only on demand via `skill` tool | **PASS** |
| 4a | `tools/pre-execute` logs tool name + args; denies `.buggps/cases/` writes for `write`, `edit`, `str_replace_editor` | **PASS** |
| 4b | Same deny via monotonic `ctx.tools.guard()` | **PASS** |
| 4c | Shell (`pwsh`) writes detectable? | **FAIL, as expected.** A string match catches the literal path, but an obfuscated path wrote the file |
| A | `engines.dsh: ">=0.2.0 <0.3.0"` accepts `0.2.1-rc.5` | **PASS** (prereleases participate) |
| A | `engines.dsh: ">=0.2.1-0 <0.3.0"` accepts `0.2.1-rc.5` | **PASS** |
| B | `dsh plugin --profile <n> add ./plugin` (link) | **PASS**; `--profile` is **required** |
| B | `--dump-config` shows `# == dsh-bug-gps` layer | **PASS** |
| B | `npm pack` tarball → `dsh plugin add ./x.tgz` → boots and loads | **PASS** |
| C | Non-interactive driving: `dsh --profile headless [--json] "<task>"` + mock LLM | **PASS** (path used for every check above) |
| — | Behaviour when the bundle fails to import / fails `engines` at startup | **Silent degrade**: stderr warning, agent runs **without** the plugin, exit 0 |
| — | PTC (`run_code`) nested calls through `tools/pre-execute`; subagent calls | **UNKNOWN** (not tested; base uses the native executor) |

---

## How the test was driven (C)

- **Path used:** the real CLI, one-shot headless profile. The plugin was installed into `headless`, the `--patch` overlay adds `str_replace_editor`, and the provider is pointed at a local scripted mock:
  ```powershell
  subst Q: <repo>\spikes\s1-dsh            # see B4
  . Q:\env.ps1                            # DSH_HOME=Q:\dsh-home, local dsh/pnpm on PATH
  dsh plugin --profile headless add ./plugin
  powershell -File Q:\run-scenario.ps1 main pre     # or: main guard | probe
  node mock\summarize.mjs work\mock-main-pre.jsonl   # tool call -> tool_result table
  ```
  `run-scenario.ps1` does three things: it starts `mock/server.mjs`, it sets `DEEPSEEK_BASE_URL=http://127.0.0.1:8765/v1` and `DEEPSEEK_API_KEY=mock-key` (read by `@deepseek-ai/dsh-llm-deepseek-api-key`), and it runs `dsh --profile headless --patch mock/editor.patch.yml "run the main scenario"` while polling `Win32_Process` every 300 ms for the tagged child processes.
- **Why a custom mock:** `@deepseek-ai/dsh-llm-mock-server` is on npm (`0.0.1-rc.1`), but its CLI scripts one fixed `--tool-name/--tool-arguments`. The `job_kill` step needs the job id returned by the previous tool result. `mock/server.mjs` (~100 lines) builds each step from the request it receives. Requests without tools (session-title generation) get plain text and do not advance the script.
- **`@deepseek-ai/dsh-tool-testkit`** is on npm only as `0.2.2-alpha.2`, which doesn't match the 0.2.1 line, so I didn't use it. The headless CLI path tests more anyway: real install, real loader, real policies.
- **Other surfaces** (from `--help`): `dsh --profile headless [--json] [--session-id <id>] [task...]`, where `-` reads stdin and exit 0 means the turn completed. `--json` writes NDJSON events:
  ```
  {"type":"session","sessionId":"session-85abd266-…","cwd":"…"}
  {"type":"status","phase":"turn_start","turn":1}
  {"type":"status","phase":"step_start","turn":1,"step":1}
  {"type":"text","text":"probe done"}
  {"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}
  {"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
  {"type":"final","text":"probe done"}
  ```
  `dsh --profile sdk` serves stdio JSON-RPC. `dsh web` takes `--host/--port/--no-open/--public-url/--trusted-host/--tls-*`. Neither was exercised.
- **Real model:** not used. `~/.dsh/.credentials.yaml` exists on this machine, but the spike deliberately ran with an isolated `DSH_HOME` and never read or copied that file. The mock is deterministic and free.

## 1 — `buggps_ping` (PASS)

The first request the model received listed (trimmed): `"buggps_ping","buggps_sleep",…,"edit",…,"job_kill","job_list","job_output",…,"pwsh","read",…,"skill",…,"write"`. On Windows the shell tool is **`pwsh`**; there is no `bash`.
```
## toolu_mock_1 buggps_ping {"msg":"hello from mock"}
   is_error=false -> pong {"ok":true,"echo":"hello from mock","pid":53764,"agent":"session-3d904ed0-6166-4fa9-b464-ef3b245a811c"}
```
Plugin log line from `apply`: `"injected":[["tools",true],["jobs",true],["skills",true],["subprocess",true]]`.

## 2 — background job, `job_kill`, process tree, `exec.signal`

Every variant ran `node -e …` as the parent, and the parent spawned a `node -e "setInterval(()=>{},1000)"` grandchild. Both processes carried a tag in their command line. The process timeline below is taken from `work/main-pre.procs.log`, showing only the snapshots where the process set changed:
```
19:02:50.225 90088/S1TAG-sub 56156/S1TAG-sub 8480/S1TAG-sub-grandchild      <- ctx.subprocess (90088 = DSH job helper)
19:02:52.593 4776/S1TAG-rawkill 86660/S1TAG-rawkill-grandchild               <- sub tree gone after job_kill
19:02:54.895                                                                 <- raw child.kill(): both gone (*)
19:02:55.760 35228/S1TAG-rawtree 104896/S1TAG-rawtree-grandchild
19:02:59.026 93964/S1TAG-subdet 50280/S1TAG-subdet 109340/S1TAG-subdet-grandchild
19:03:01.398 90696/S1TAG-rawkilldet 15464/S1TAG-rawkilldet-grandchild        <- subprocess+detached: gone
19:03:03.660 15464/S1TAG-rawkilldet-grandchild 105232/S1TAG-rawtreedet ...   <- raw kill + detached: GRANDCHILD LEAKS
19:03:06.793 15464/… 111324/S1TAG-fg 39304/S1TAG-fg 21592/S1TAG-fg-grandchild
19:03:10.543 15464/… 111324/S1TAG-fg                                         <- fg tree gone after exec.signal abort
19:03:11.435 15464/S1TAG-rawkilldet-grandchild
run-scenario: "surviving tagged processes after dsh exit: 15464=S1TAG-rawkilldet-grandchild"
```
(I killed pid 15464 by hand afterwards. The leak reproduced in the `guard` run as pid 57740.)

| producer strategy | grandchild attached | grandchild `detached:true` |
|---|---|---|
| `ctx.subprocess.spawn` + `handle.terminate()` | tree killed | **tree killed** (Windows kill-on-close Job, per `dsh-subprocess-local` README) |
| raw `child_process.spawn` + `taskkill /PID /T /F` | tree killed | tree killed |
| raw `child_process.spawn` + `child.kill()` | tree killed (*) | **grandchild leaks** |

(*) Only because libuv puts non-detached Node children in its own kill-on-close job. That is not a property you can rely on for Edge or Playwright processes.

The tool results are all in the shape `started background job buggps-2029c74d10324be6 tag=S1TAG-sub`, and `job_kill` returns `requested cancellation of job buggps-…`. The plugin log shows `cancel(reason)` receiving the model's `reason` verbatim, with `done` resolving in about 35 ms for `ctx.subprocess` and about 800 ms for `taskkill`.

**`exec.signal`:** `buggps_sleep(background:false)` declares `timeoutMs: 4000`. The base bundle's `@deepseek-ai/dsh-tool-call-timeout-policy` aborts `exec.signal` after that, the body stops the tree, and the model receives:
```
## toolu_mock_15 buggps_sleep {"mode":"subprocess","background":false,"detached":true,"tag":"S1TAG-fg"}
   is_error=true -> Error: tool call timed out after 4000ms
plugin log: {"event":"sleep-fg-aborted","mode":"subprocess","tag":"S1TAG-fg","reason":"TimeoutReason: TOOL_TIMEOUT after 4000ms"}
```
I did not test cancelling with Ctrl+C or SIGINT on the CLI.

## 3 — skill (PASS)

The skill is registered in `apply` with `ctx.skills.register({ name:'buggps', description, source:'runtime', content })`. **`source` is required** by the `SkillRegistration` type (`dsh-skill/lib/types/index.d.ts`).

- **Catalog:** the first model request carries it in a `<system-reminder>` text block on the first user message, not in `system`:
  ```
  <available_skills>
  - `buggps`: BugGPS: fix a recorded browser bug; only buggps_verify may declare RED-&gt;GREEN.
  ```
  The body marker `MARKER-BUGGPS-SKILL-BODY-7f3a` was **absent** from that request, so the body loads lazily.
- **On demand:**
  ```
  ## toolu_mock_2 skill {"name":"buggps"}
     is_error=false -> <skill_content name="buggps"> <skill_resources> Resources for this skill are managed by provider "runtime". … </skill_resources> <skill_instructions> # BugGPS skill body MARKER-BUGGPS-SKILL-BODY-7f3a. … </skill_instructions> </skill_content>
  ```

## 4 — write protection for `.buggps/cases/`

The listener uses `ctx.on('tools/pre-execute', async (exec, next) => …)` and returns `{ kind:'deny', reason }` or `next()`. The guard variant (`BUGGPS_SPIKE_DENY_VIA=guard`) uses `ctx.tools.guard(exec => reason | undefined)`. Both variants produced **identical** results. `<PROJ>` stands for the long working directory.
```
write  {"file_path":".buggps/cases/case1/check.json"}                         -> Error: BugGPS: … write-protected
write  {"file_path":"<PROJ>\\.buggps\\cases\\case1\\check.json"}              -> denied
read   {"file_path":"<PROJ>/.buggps/cases/case1/check.json"}                  -> allowed (reads not blocked)
edit   {"file_path":"<PROJ>/.buggps/cases/case1/check.json",…}                -> denied
write  {"file_path":"<PROJ>/.BugGPS/Cases/case1/check.json"}                  -> denied (case-insensitive regex)
write  {"file_path":"<PROJ>/.buggps/cases/../cases/case1/check.json"}         -> denied
str_replace_editor {"command":"create","path":"<PROJ>/.buggps/cases/case2/new.json",…}     -> denied
str_replace_editor {"command":"str_replace","path":"<PROJ>\\.buggps\\cases\\case1\\check.json",…} -> denied
write  {"file_path":"<PROJ>/src/ok.txt"}                                      -> Created file (control)
pwsh   {"command":"Set-Content -Path .buggps/cases/case1/check.json -Value tampered-direct",…}  -> denied (string match)
pwsh   {"command":"$p = \".bug\" + \"gps/ca\" + \"ses/case1/check.json\"; Set-Content -Path $p …"} -> ALLOWED, "(no output)"
pwsh   {"command":"Get-Content .buggps/cases/case1/check.json",…}            -> denied (false positive: a read)
run-scenario: check.json now: tampered-obfuscated
```

Is the target path reliably visible in the args?

| tool (package) | arg holding the path | visible? | notes |
|---|---|---|---|
| `write`, `edit`, `read` (`dsh-tool-fs`) | `file_path` | **yes** | Arrives exactly as the model sent it, **before** normalisation: relative, `\` or `/`, any case, with `..`. `pre-execute` can't rewrite args. |
| `str_replace_editor` (`dsh-tool-str-replace-editor`, **not** in `dsh-base`; added via `--patch`) | `path` (+ `command`) | **yes** | The README says paths must be absolute. |
| `pwsh` (`dsh-tool-pwsh`; `bash` on POSIX) | `command` (+ required `description`) | **no** | Only free text. String concatenation, variables, scripts, `node -e`, `git checkout` etc. all bypass. Not reliably detectable. |

So the path guard has to resolve paths itself (cwd + `path.resolve` + realpath to defeat `..` and junctions) and compare case-insensitively on Windows. The shell gap has to be closed outside the policy layer: hash-verify `.buggps/cases/**` inside `buggps_verify` (content-hash lock, already in the plan). The sandbox ACLs could add a second line of defence, but I didn't test that.

## A — `engines.dsh` / peer matching against `0.2.1-rc.5` (`engines-matrix.ps1`, `work/engines-matrix.txt`)

| manifest | `dsh plugin add` |
|---|---|
| `engines.dsh: ">=0.2.0 <0.3.0"` | **accepted** |
| `engines.dsh: ">=0.2.1-0 <0.3.0"` | **accepted** |
| `engines.dsh: ">=0.2.1 <0.3.0"` | rejected |
| `engines.dsh: "^0.3.0"` | rejected |
| `engines.dsh: "workspace:^"` | rejected |
| no engines, peer `@deepseek-ai/dsh-tools: "0.2.1-rc.5"` | accepted |
| no engines, peer `"^0.2.0"` | accepted |
| no engines, peer `">=0.2.0 <0.3.0"` | accepted |

Exact install-time refusal (exit 1):
```
dsh: installation rejected: Plugin dsh-bug-gps-e3@0.0.0 is incompatible with dsh 0.2.1-rc.5: requirements {"engines.dsh":">=0.2.1 <0.3.0"}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for dsh-bug-gps-e3@0.0.0 on dsh 0.2.1-rc.5 with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.
dsh: nothing was installed.
dsh: to accept the risk, run: dsh plugin --profile eng-e3 allow-version dsh-bug-gps-e3@0.0.0 --dsh-version 0.2.1-rc.5 --accept-risk
```
Startup-time refusal: I edited the installed plugin to `"^0.3.0"` and booted the headless profile. **The exit code was 0 and the agent answered normally:**
```
dsh: skipping profile bundle "dsh-bug-gps": Error: Plugin dsh-bug-gps@0.0.0-spike.1 is incompatible with dsh 0.2.1-rc.5: requirements {"engines.dsh":"^0.3.0"}. … Exact-version exemption: not active.
```
The checker lives in `dsh-app-boot/lib/index.js`. If `engines.dsh` is present it decides alone and `peerDependencies` are ignored; prereleases are included in matching. This matches the rule in `packages/boot/app-boot/README.md#profiles`. Recommendation: use `">=0.2.1-0 <0.3.0"`, which states the real floor (the rc line) and is accepted.

## B — install commands

1. **`--profile` is required:** `dsh plugin add ./plugin` → `error: required option '--profile <name>' not specified` (exit 1).
2. **Link install:**
   ```
   > dsh plugin --profile spike add ./plugin
   dsh: initialized profile spike at Q:\dsh-home\profiles\spike
   + dsh-bug-gps link:Q:/plugin
   Done in 1s using pnpm v10.34.9
   ```
   This writes `"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "dsh-bug-gps"]}}`. Using `--profile headless` instead auto-initialises from the shipped template, giving `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-headless","dsh-bug-gps"]`. `dsh plugin --profile headless remove dsh-bug-gps` removes both the dependency and the layer.
3. **pnpm is not bundled.** `dsh plugin` shells out to `pnpm` on `PATH`, and `@deepseek-ai/dsh` has no pnpm dependency. I installed `pnpm@10` locally in `spikes/s1-dsh/dsh/` and put its `.bin` on `PATH`. BugGPS install docs must say "needs pnpm ≥10 on PATH".
4. **Windows path length:** with `DSH_HOME` under this folder (~200 chars) the first `add` failed with `Error: ENAMETOOLONG: name too long, mkdtemp '…\dsh-home\profiles\spike\.plugin-manager\logs\operation-XXXXXX'` (`LongPathsEnabled=0`). Workaround: `subst Q:` for `DSH_HOME` only. Note that a linked plugin must be added by its **real** path, not through the subst drive. With `link:Q:/plugin` the import failed (`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools' imported from Q:\plugin\index.js`), because DSH matches linked roots by native realpath (`realpathSync.native` resolves `Q:` to `C:\…`). The default `~/.dsh` is short, so normal users won't hit this.
5. **`--dump-config`:** `dsh --profile spike --dump-config` (exit 0) prints layer headers `# == @deepseek-ai/dsh-base` and `# == dsh-bug-gps`, then:
   ```yaml
   # == dsh-bug-gps
   - id: buggps
     name: dsh-bug-gps
   ```
6. **Tarball:** `npm pack --pack-destination ../work` produced a 3.7 kB package with 3 files. I created the profile with `dsh --profile tgz --from-default-profile headless --dump-config`, then ran `dsh plugin --profile tgz add ./dsh-bug-gps-0.0.0-spike.1.tgz`:
   ```
    WARN  Issues with peer dependencies found
   └─┬ dsh-bug-gps 0.0.0-spike.1
     └── ✕ missing peer @deepseek-ai/dsh-tools@">=0.2.0-0 <0.3.0"
   + dsh-bug-gps file:C:/…/work/dsh-bug-gps-0.0.0-spike.1.tgz
   ```
   The warning is harmless: the profile's `node_modules` holds only `dsh-bug-gps`, and the boot loaded it with the peer taken from the DSH installation (`apply` logged, `buggps_ping`/`buggps_sleep` visible, exit 0). The linked checkout likewise needed **no `node_modules` of its own**: I never installed devDependencies.

## Working manifests

`plugin/package.json`:
```json
{
  "name": "dsh-bug-gps",
  "version": "0.0.0-spike.1",
  "private": true,
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "dsh": ">=0.2.0 <0.3.0" },
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.2.0-0 <0.3.0" },
  "devDependencies": { "@deepseek-ai/dsh-tools": "0.2.1-rc.5" }
}
```
`plugin/cordis.patch.yml`:
```yaml
- insert:
    - id: buggps
      name: dsh-bug-gps
```
`mock/editor.patch.yml` (test-only overlay; `str_replace_editor` is not in `dsh-base`):
```yaml
- insert:
    - id: tool-str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
```

## API facts for BugGPS's real `src/dsh/`

**Use:**
- `export const name`, `export const inject = ['tools','jobs','skills','subprocess']`, `export function apply(ctx)`. All four services are present in `dsh-base`. The service names (`"tools"`, `"jobs"`, `"skills"`) were read from each package's `lib/index.js`.
- `defineTool` from `@deepseek-ai/dsh-tools`. Parameters are a flat map with per-property `required: true`. `output.schema` is required, and an object node must declare `additionalProperties`. `output.render(args, value)` returns `[{type:'text', text}]`. `execute` returns only the canonical JSON value.
- `ctx.jobs.start({ kind, label, owner: exec.agent.id, toolCall: { callId: exec.callId, rootCallId: exec.rootCallId }, run(job) { return { done, cancel } } })`. It returns the `JobId` synchronously.
  - **`owner` is a `SessionId` (`exec.agent.id`), not the `Agent`.** The adding-a-tool cookbook says `owner: exec.agent`; `dsh-jobs/lib/types/types.d.ts` and `tool-bash` use `.id`.
  - `cancel` must be synchronous and idempotent. `done` must never reject and should resolve `{ status: 'killed' | 'completed' | 'failed', detail }`.
  - Use a task-owned signal after start, not `exec.signal`.
  - `kind` is any string at runtime. In TypeScript, augment `JobKindMap` in `@deepseek-ai/dsh-jobs`.
- **Spawn the browser/driver with `ctx.subprocess.spawn({ argv, cwd, stdio:{stdin:'ignore', stdout:{maxBytes}, stderr:{maxBytes}}, graceMs, signal? })`** and stop it with `handle.terminate()` / `await handle.waitForExit()`. That is the only strategy tested that also kills detached descendants on Windows. The handle has no `pid`. `collected.stdout.readFrom(0)` returns `{ text, nextOffset, lossy }`.
- Foreground long work: declare `timeoutMs` on the definition (the base bundle enforces it by aborting `exec.signal`) and honor `exec.signal`.
- `ctx.skills.register({ name, description, source: 'runtime', content })`. The kebab-case name is advertised in the session's skill catalog, and the body is served by the built-in `skill` tool.
- Protection: `ctx.tools.guard(exec => reason | undefined)` for the final, non-overridable deny (later `pre-execute` listeners can't undo it). Add an optional `ctx.on('tools/pre-execute', …)` for logging or `ask`.
  - Match `exec.name` ∈ {`write`,`edit`,`str_replace_editor`} and read `exec.arguments.file_path` / `.path`.
  - Normalise them yourself: resolve relative to the session cwd, then realpath, then compare case-insensitively.
- The integrity check stays in `buggps_verify` (content hash of `.buggps/cases/**`), because the shell is a hole.
- `engines.dsh: ">=0.2.1-0 <0.3.0"` plus `@deepseek-ai/dsh-*` as peer and dev dependencies. Ship as an npm tarball or registry package; a git install needs a `prepare` build and a pnpm `allowBuilds` entry per `publish.md`.
- E2E tests: `dsh --profile headless [--json] "<task>"` against a scripted Messages mock via `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`, with an isolated `DSH_HOME`. `mock/server.mjs` here is a working starting point.

**Avoid / watch out:**
- **Don't assume the guard is loaded.** An import error and a startup `engines` mismatch both just print a stderr warning (`dsh: warning: 1 entry did not activate` / `dsh: skipping profile bundle …`), and the run continues with exit 0.
  - `buggps_verify` (or a `buggps doctor`) must prove that the guard is active in the same process. One way: a module-level flag set in `apply`.
  - The CLI wrapper should treat those stderr lines as fatal.
- Raw `child_process` + `child.kill()` for anything that spawns descendants: it leaks detached grandchildren.
- Relying on shell-command string matching for protection.
- Relying on `tools/pre-execute` to rewrite args: not supported (`packages/core/tools/README.md`, Known Limitations).
- Assuming `str_replace_editor` or `bash` exist: base gives `write`/`edit`/`read` + `pwsh` on Windows.
- `SKILL.md` files inside the package are not registered automatically (known from the earlier docs research). Register the skill from code as above.
- Deep `DSH_HOME` paths on Windows (`ENAMETOOLONG`), and `subst`/mapped-drive spellings for linked plugins.

## Sources relied on

- deepseek-ai/deepseek-harness@master (raw.githubusercontent.com):
  - `docs/user/develop/basic/publish.md`
  - `docs/cookbook/adding-a-tool.md`
  - `docs/cookbook/extension-cookbook.md`
  - `packages/core/tools/README.md`
  - `docs/subsystems/tools.md` (`tools/pre-execute` signature, `PreToolDecision`)
  - `packages/jobs/jobs/README.md`
  - `packages/jobs/tool-jobs/README.md`
  - `packages/boot/app-boot/README.md` (engines rule)
  - `apps/cli/reference/README.md`
  - `packages/test-support/llm-mock-server/README.md`
  - `packages/bundle/base/cordis.patch.yml`
  - `packages/shell/tool-bash/src/index.ts` (jobs usage: `owner: exec.agent.id`)
- Installed 0.2.1-rc.5 packages under `spikes/s1-dsh/dsh/node_modules/@deepseek-ai/`:
  - `dsh-skill/lib/types/index.d.ts`
  - `dsh-jobs/lib/types/types.d.ts`
  - `dsh-tools/lib/types/{schema,index}.d.ts`
  - `dsh-subprocess/lib/types/types.d.ts` and `README.md`
  - `dsh-subprocess-local/README.md`
  - `dsh-tool-fs/README.md`
  - `dsh-tool-str-replace-editor/README.md`
  - `dsh-tool-call-timeout-policy/README.md`
  - `dsh-llm-deepseek-api-key/lib/index.js`
  - `dsh-app-boot/lib/index.js` (engines checker, linked-peer interception)

## Files in `spikes/s1-dsh/`

- `plugin/` — the bundle: `package.json`, `cordis.patch.yml`, `index.js`.
- `mock/` — `server.mjs` (the scripted LLM), `summarize.mjs`, `editor.patch.yml`.
- `env.ps1` — sets up the isolated environment.
- `run-scenario.ps1` — the scenario runner with the process poller.
- `engines-matrix.ps1` — the `engines`/peer matrix.
- `.gitignore` — ignores `dsh/`, `dsh-home/`, `work/` and `*.tgz`. `work/` holds every raw log quoted above: `mock-*.jsonl`, `*.plugin.log`, `*.procs.log`, `*.stdout/.stderr`, `engines-matrix.txt` and `dump-config.yml`.
- To re-run: `subst Q: <this folder>`, then `. Q:\env.ps1`, then the commands in section C. Remove the drive with `subst Q: /d`.

Housekeeping: I committed nothing. The `Q:` subst drive was removed after the spike. The leaked test processes were killed by hand. During the spike, a profile `~/.dsh/profiles/ac-web` was created at 19:02. It contains no `dsh-bug-gps` reference and was not created by this spike: every `dsh` call here ran with `DSH_HOME=Q:\dsh-home`.
