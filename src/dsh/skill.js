// The skill only routes and sets the rules; all judging happens in the tools.
export const SKILL = {
  name: 'buggps',
  description: 'BugGPS: when the user reports a bug they can show in a running web app, record it once with the correct expectation, lock it as a failing check, fix the code, and let buggps_verify decide on code it starts itself.',
  content: `# BugGPS workflow

Use this when the user has a bug they can reproduce in their running web app (dev server).

1. Ask for the dev server URL if you do not know it. Call **buggps_record** with it. A browser opens for the USER: they reproduce the bug, mark on the BugGPS toolbar what SHOULD be shown, optionally mark checkpoints ("at this point it shows …") and the key step, and press stop. Tell them that before calling.
2. Ask the user how BugGPS should start the app itself (dev command and a FREE port, e.g. \`npm run dev -- --port 5199 --strictPort\` → \`http://127.0.0.1:5199/\`), unless \`buggps.config.json\` already has \`serve\` (buggps_status shows it). Call **buggps_lock** with the draft (and serve / serve_url). It locks only if the bug shows in every run. If it returns anything other than LOCKED, follow its \`next\` field.
3. Use \`expectation\`, \`observed_now\` and \`shortest_steps\` to find the cause in the application code. Fix it with your normal tools.
4. Call **buggps_verify** with the case_id. Repeat 3–4 until it returns VERIFIED.

Rules:
- Only VERIFIED from buggps_verify means fixed. Never say "fixed" on any other verdict.
  - PASSED_UNBOUND: passed on a server BugGPS did not start; not evidence for the patch.
  - NEEDS_REVIEW: show the user \`review_reasons\` and the patch; the user decides.
  - DIFFERENT_FAILURE / STILL_FAILING: keep fixing.
- Never create, edit, move or delete anything under \`.buggps/\` (write-protected and content-hashed; tampering voids the verdict). Never change the serve command in \`buggps.config.json\` to make a check pass.
- Never weaken the expectation, change the recording, or skip the check. If the UI changed on purpose and the recording no longer replays, ask the user to record again.
- Never ask for passwords or tokens in chat. Secret inputs are replayed from BUGGPS_SECRET_* environment variables the user sets.
- VERIFIED covers the recorded scenario only. Say so; do not claim other bugs are gone.
- An ENV_BLOCKED result is about the environment (browser, port, dev server, secrets), not the code.
`,
};
