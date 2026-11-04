// The skill only routes and sets the rules; all judging happens in the tools.
export const SKILL = {
  name: 'buggps',
  description: 'BugGPS: when the user reports a bug they can show in a running web app, record it once with the correct expectation, lock it as a failing check, fix the code, and let buggps_verify decide on code it starts itself.',
  content: `# BugGPS workflow

Use this when the user has a bug they can reproduce in their running web app (dev server).

1. Reuse an existing recorded draft when one was provided, preserving its expectation and source. Otherwise ask for the dev server URL if you do not know it, then call **buggps_record**. A browser opens for the USER: they reproduce the bug, mark on the BugGPS toolbar what SHOULD be shown, optionally mark checkpoints ("at this point it shows …") and the key step, and press stop. Tell them that before calling.
2. Ask the user how BugGPS should start the app itself (dev command and a FREE port, e.g. \`npm run dev -- --port 5199 --strictPort\` → \`http://127.0.0.1:5199/\`), unless \`buggps.config.json\` already has \`serve\` (buggps_status shows it). Call **buggps_lock** with the draft (and serve / serve_url). It locks only if the bug shows in every run. If it returns anything other than LOCKED, follow its \`next\` field.
3. Use \`expectation\`, \`observed_now\` and \`shortened_steps\` to find the cause in the application code. Fix it with your normal tools. A shorter path is not proven minimal or causal.
4. Call **buggps_verify** with the case_id. When the user requested a repair, NO_CODE_CHANGE is a baseline checkpoint: continue with step 3, edit application source and verify again. Repeat 3–4 for STILL_FAILING or DIFFERENT_FAILURE. Report other verdicts according to their next action; a review verdict does not authorize changing the case. When the user requested verification only, report NO_CODE_CHANGE without making extra edits.

Rules:
- Keep the recorded source, captureVersion, capturedChecks and expectedFrom unchanged. Legacy recordings, capture issues or a mismatch with the captured original state need a new recording; never add a version field or rewrite observations to bypass validation.
- Tool text marked \`output_preview: abbreviated\` is a preview. Read the referenced draft, run_record or patch_file, or the saved case under \`.buggps/cases/<case_id>/\`, when more detail is needed. Never reconstruct a test or adopt a patch from abbreviated text; complete structured values and saved evidence remain unchanged.
- Only VERIFIED from buggps_verify means fixed. Never say "fixed" on any other verdict.
  - PASSED_UNBOUND: passed on a server BugGPS did not start; not evidence for the patch.
  - NEEDS_REVIEW: show the user \`review_reasons\` and the patch; the user decides.
  - DIFFERENT_FAILURE / STILL_FAILING: keep fixing.
  - NO_CODE_CHANGE: the locked baseline is unchanged. Continue a requested repair; for a verification-only request, report the unchanged baseline.
- Never create, edit, move or delete anything under \`.buggps/\` (write-protected and content-hashed; tampering voids the verdict). Never change the serve command in \`buggps.config.json\` to make a check pass.
- Never weaken the expectation, change the recording, or skip the check. If the UI changed on purpose and the recording no longer replays, ask the user to record again.
- Never ask for passwords or tokens in chat. Secret inputs are replayed from BUGGPS_SECRET_* environment variables the user sets.
- VERIFIED covers the recorded scenario only. Say so; do not claim other bugs are gone.
- Describe the observation window as sampled checks, including its interval and scope.
- An ENV_BLOCKED result is about the environment (browser, port, dev server, secrets), not the code.
`,
};
