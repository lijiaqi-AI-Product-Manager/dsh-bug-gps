// The skill only routes and sets the rules; all judging happens in the tools.
export const SKILL = {
  name: 'buggps',
  description: 'BugGPS: when the user reports a bug they can show in a running web app, record it once, lock it as a failing check, fix the code, and let buggps_verify decide whether it is fixed.',
  content: `# BugGPS workflow

Use this when the user has a bug they can reproduce in their running web app (dev server).

1. Ask for the dev server URL if you do not know it. Call **buggps_record** with it. A browser opens for the USER: they reproduce the bug, set the correct expectation on the BugGPS toolbar, mark the key step, and press stop. Tell them that before calling.
2. Call **buggps_lock** with the draft it returns. It locks the case only if the bug shows in every run on the current code. If it returns anything other than LOCKED, follow its \`next\` field. Do not lock it any other way.
3. Use \`expectation\`, \`observed_now\` and \`shortest_steps\` to find the cause in the application code. Fix it with your normal tools.
4. Call **buggps_verify** with the case_id. Repeat 3–4 until it returns VERIFIED.

Rules:
- Only buggps_verify decides whether the case is fixed. Never say "fixed" on any other verdict. NEEDS_REVIEW means ask the user.
- Never create, edit, move or delete anything under \`.buggps/\` (write-protected and content-hashed; tampering voids the verdict).
- Never weaken the expectation, change the recording, or skip the check. If the UI changed on purpose and the recording no longer replays, ask the user to record again.
- VERIFIED covers the recorded scenario only. Say so; do not claim other bugs are gone.
- An ENV_BLOCKED result is about the environment (dev server, browser), not the code.
`,
};
