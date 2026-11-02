#!/usr/bin/env node
// Generates docs/media/buggps-demo.gif (and .mp4) from a REAL run on the seeded example:
// the browser part is the actual recorder toolbar on the actual page, and every tool result
// shown comes from this run. Actions and code edits are scripted; result cards are presentation
// layouts. The cursor, click ripple and captions are drawn on top. Needs ffmpeg on PATH.
//
//   node docs/demo/make-demo.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../src/core/browser.js';
import { startRecording } from '../../src/core/recorder.js';
import { startStaticServer } from '../../examples/serve.js';
import { createToolSpecs } from '../../src/dsh/tools.js';
import { hashLock } from '../../src/core/caselock.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'docs', 'media');
const W = 960;
const H = 600;
const frames = []; // { file, seconds }
let frameDir;
let server; let env;
let disposed = false;
async function dispose() {
  if (disposed) return;
  disposed = true;
  try { await env?.browser.close(); } finally { await server?.close(); }
}

// ---------- project: the seeded example as its own git repo ----------
const repo = await mkdtemp(join(tmpdir(), 'buggps-demo-'));
try {
await cp(join(ROOT, 'examples', 'cart-shop'), repo, { recursive: true });
await cp(join(ROOT, 'examples', 'serve.js'), join(repo, 'serve.js'));
await writeFile(join(repo, 'buggps.config.json'), JSON.stringify({ serve: { command: ['node', 'serve.js', '.', '5180'], url: 'http://127.0.0.1:5180/' } }));
const git = (...a) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', ...a], { cwd: repo, stdio: 'pipe' });
git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'seeded example');
frameDir = await mkdtemp(join(tmpdir(), 'buggps-frames-'));
server = await startStaticServer(repo);
env = await launchBrowser();
// Direct tool execution for the seeded demo; the real host guard has separate integration coverage.
const tools = createToolSpecs({ resolveCwd: async () => repo, guardActive: () => true });
const tool = (name) => tools.find((t) => t.name === name);
const exec = () => ({ signal: new AbortController().signal });
const textOf = (name, args, value) => tool(name).output.render(args, value)[0].text;

// ---------- drawing helpers ----------
const OVERLAY_CSS = `
#__demo{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif}
#__demo .cap{position:absolute;right:16px;top:52px;width:390px;background:rgba(17,17,17,.9);color:#fff;padding:12px 16px;border-radius:10px;font-size:18px;line-height:1.45;box-shadow:0 4px 14px #0004}
#__demo .cap small{display:block;opacity:.7;font-size:13px}
#__demo .cur{position:absolute;width:22px;height:22px;transform:translate(-3px,-2px)}
#__demo .rip{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #2d6cdf;background:rgba(45,108,223,.18)}
#__demo .hl{position:absolute;border:3px solid #e74c3c;border-radius:6px}
#__demo .hl.ok{border-color:#27ae60}
#__demo .tag{position:absolute;background:#e74c3c;color:#fff;font-size:14px;padding:3px 8px;border-radius:5px;white-space:nowrap}
#__demo .tag.ok{background:#27ae60}
#__demo .step{position:absolute;top:14px;right:16px;background:#2d6cdf;color:#fff;font-size:13px;padding:3px 9px;border-radius:12px}`;
const PAGE_CSS = 'body{margin:14px 24px;zoom:1.15} h1{margin:4px 0} h2{margin:8px 0 4px}';
const CURSOR = '<svg class="cur" viewBox="0 0 22 22"><path d="M2 1l16 9-7 2-3 7z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';

async function boxOf(locator) {
  const b = await locator.boundingBox();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 } : null;
}

async function draw(page, { caption, sub, cursor, ripple, highlight, tag, ok, step } = {}) {
  await page.evaluate(({ css, html }) => {
    let root = document.getElementById('__demo');
    if (!root) {
      root = document.createElement('div');
      root.id = '__demo';
      const st = document.createElement('style');
      st.textContent = css;
      document.documentElement.append(st, root);
    }
    root.innerHTML = html;
  }, {
    css: OVERLAY_CSS,
    html: [
      step ? `<div class="step">${step}</div>` : '',
      highlight ? `<div class="hl${ok ? ' ok' : ''}" style="left:${highlight.x - 5}px;top:${highlight.y - 4}px;width:${highlight.w + 10}px;height:${highlight.h + 8}px"></div>` : '',
      highlight && tag ? `<div class="tag${ok ? ' ok' : ''}" style="left:${highlight.x + highlight.w + 14}px;top:${highlight.y - 2}px">${tag}</div>` : '',
      ripple ? `<div class="rip" style="left:${ripple.cx}px;top:${ripple.cy}px"></div>` : '',
      cursor ? `<div style="position:absolute;left:${cursor.cx}px;top:${cursor.cy}px">${CURSOR}</div>` : '',
      caption ? `<div class="cap">${caption}${sub ? `<small>${sub}</small>` : ''}</div>` : '',
    ].join(''),
  });
}

async function shot(page, seconds) {
  const file = join(frameDir, `f${String(frames.length).padStart(3, '0')}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, seconds });
}

// Move the cursor onto an element, show the click, then perform it (overlay removed first so
// the screenshot after the action shows the page's real reaction).
async function clickWith(page, locator, caption, sub, step) {
  const b = await boxOf(locator);
  await draw(page, { caption, sub, cursor: b, step });
  await shot(page, 0.8);
  await draw(page, { caption, sub, cursor: b, ripple: b, step });
  await shot(page, 0.35);
  await draw(page, {});
  await locator.click();
  await page.waitForTimeout(150);
}

// Full-frame card: title, terminal output, diff.
async function card(html, seconds) {
  const ctx = await env.browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;width:${W}px;height:${H}px;background:#0f1419;color:#e6e6e6;font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;display:flex;flex-direction:column}
    .top{padding:22px 30px 6px;font-size:22px;font-weight:600}
    .top small{display:block;font-size:14px;font-weight:400;opacity:.65;margin-top:4px}
    .term{margin:10px 30px;background:#1b2128;border:1px solid #2c3540;border-radius:10px;padding:18px 22px;font:17px/1.6 Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;flex:1;overflow:hidden}
    .term .k{color:#7aa2f7}.term .bad{color:#ff7b72;font-weight:700}.term .good{color:#3fb950;font-weight:700}.term .dim{opacity:.6}
    .term .add{color:#3fb950}.term .del{color:#ff7b72}
    .foot{padding:0 30px 16px;font-size:13px;opacity:.55}
    .hero{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 60px}
    .hero h1{font-size:46px;margin:0 0 10px}.hero p{font-size:22px;margin:6px 0;opacity:.9}.hero .en{opacity:.6;font-size:18px}
    .chips{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap}.chips span{background:#1f6feb33;border:1px solid #1f6feb;border-radius:16px;padding:5px 12px;font-size:15px}
    code{font-family:Consolas,monospace;background:#1b2128;padding:2px 8px;border-radius:5px}
  </style><body>${html}</body>`);
  const clipped = await page.locator('.term').evaluateAll((elements) => elements.some((el) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2));
  if (clipped) throw new Error('Demo result card would clip its contents');
  const file = join(frameDir, `f${String(frames.length).padStart(3, '0')}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, seconds });
  await ctx.close();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Picks the lines of a tool result worth reading in a demo; colours the verdict.
function term(text, keys) {
  const lines = text.split('\n');
  const head = lines[0].replace(/^BugGPS (\S+)/, (_, s) => `BugGPS <span class="${/VERIFIED|LOCKED/.test(s) ? 'good' : 'bad'}">${s}</span>`);
  const body = lines.slice(1).filter((l) => keys.some((k) => l.startsWith(`${k}:`))).map((l) => {
    const [k, ...v] = l.split(': ');
    let val = v.join(': ');
    if (k === 'minimization') { try { const m = JSON.parse(val); val = `录制 ${m.from} 步 → 较短 ${m.to} 步 · ${m.trials} 次重放 · 模型调用 ${m.model_calls}`; } catch { /* keep raw */ } }
    return `<span class="k">${esc(k)}:</span> ${esc(val.length > 150 ? `${val.slice(0, 147)}...` : val)}`;
  });
  return [head, ...body].join('\n');
}

// ---------- scene 0: title ----------
await card(`<div class="hero"><h1>BugGPS</h1><p>录下问题，按原预期复核修复。</p><p class="en">Record the bug. Verify the fix against the original expectation.</p>
  <div class="chips"><span>DeepSeek Harness 插件</span><span>系统 Edge / Chrome</span><span>验证由工具判定</span><span>缩减步骤零模型调用</span></div></div>
  <div class="foot">植入 bug 示例 · 脚本操作与预置修改 · 实跑关键帧剪辑，片长不代表任务耗时</div>`, 3.2);

// ---------- scene 1: the user records the bug once ----------
const rec = await startRecording(env.browser, { baseUrl: server.url, toolbar: true });
const page = rec.page;
await page.setViewportSize({ width: W, height: H });
await page.addStyleTag({ content: PAGE_CSS });
page.on('dialog', (d) => d.accept('$18.00'));
await page.waitForTimeout(300);
const S = '① 录制 Record';
await draw(page, { caption: 'BugGPS 打开浏览器，你照常把 bug 操作一遍', sub: 'A browser opens; you reproduce the bug once. The toolbar (bottom right) is BugGPS.', step: S });
await shot(page, 2.2);
await clickWith(page, page.getByRole('button', { name: 'Add Apple' }), '加入 Apple（$10）', 'Add Apple', S);
await clickWith(page, page.getByRole('button', { name: 'Add Cherry' }), '先随手加了 Cherry……', 'Real sessions wander a bit…', S);
const sort = page.getByRole('combobox', { name: 'Sort' });
await clickWith(page, sort, '……换个排序……', '…change the sort order…', S);
await sort.selectOption('price');
await clickWith(page, page.getByRole('button', { name: 'Remove Cherry' }), '……又把 Cherry 删掉', '…and remove Cherry again', S);
await clickWith(page, page.getByRole('button', { name: 'Add Banana' }), '加入 Banana（$20）', 'Add Banana', S);
await clickWith(page, page.getByText('Shipping info'), '看了眼运费说明', 'Peek at the shipping info', S);
const coupon = page.getByRole('textbox', { name: 'Coupon' });
await clickWith(page, coupon, '输入优惠码 SAVE10（九折）', 'Coupon SAVE10 = 10% off', S);
await coupon.fill('SAVE10');
await clickWith(page, page.getByRole('button', { name: 'Apply coupon' }), '应用优惠码', 'Apply coupon', S);
const total = page.getByTestId('total');
await draw(page, { caption: '总价 $27.00，正确', sub: '$30 − 10% = $27.00, correct so far', highlight: await boxOf(total), ok: true, tag: '$27.00 ✓', step: S });
await shot(page, 1.6);
await clickWith(page, page.getByRole('button', { name: 'Remove Apple' }), '删掉 Apple', 'Remove Apple', S);
await draw(page, { caption: '只剩 Banana $20，九折应为 $18.00，页面却显示 $17.00', sub: 'Bug: the discount is not recomputed after removing an item', highlight: await boxOf(total), tag: '应为 $18.00', step: S });
await shot(page, 2.6);
await clickWith(page, page.getByRole('button', { name: /预期文本/ }), '在工具栏上点「预期文本」……', 'Mark the expectation on the toolbar…', S);
await clickWith(page, total, '……点总价，填入正确值 $18.00', '…click the total and enter the correct value', S);
await draw(page, { caption: '预期已记录：总价应为 $18.00。点「结束」', sub: 'Expectation set. Stop recording.', step: S });
await shot(page, 1.6);
await clickWith(page, page.getByRole('button', { name: /结束/ }), '结束录制', 'Stop', S);
await rec.finished;
const steps = await rec.stop();
await mkdir(join(repo, '.buggps', 'drafts'), { recursive: true });
await writeFile(join(repo, '.buggps', 'drafts', 'coupon.json'), JSON.stringify({ schema: 'buggps.draft/v1', source: 'recorded', steps, browser: rec.result.browser, expectation: rec.result.expectation }));

// ---------- scene 2: lock ----------
const lockArgs = { draft: '.buggps/drafts/coupon.json', case_id: 'coupon' };
const locked = await tool('buggps_lock').execute(lockArgs, exec());
if (locked.status !== 'LOCKED') throw new Error(`lock: ${JSON.stringify(locked)}`);
await card(`<div class="top">② 锁定 Lock<small>BugGPS 自己启动应用，重放 3 次，都以同样方式失败才锁定；同时缩短步骤（不调用模型）</small></div>
  <div class="term"><span class="dim">&gt; buggps_lock draft=.buggps/drafts/coupon.json</span>\n${term(textOf('buggps_lock', lockArgs, locked), ['case_id', 'binding', 'expectation', 'observed_now', 'recorded_steps', 'minimization'])}</div>
  <div class="foot">预期已锁定并校验内容哈希 · Expectation locked and content-hashed</div>`, 4.6);

// ---------- scene 3: a plausible but wrong fix ----------
const appJs = join(repo, 'app.js');
const src = (await readFile(appJs, 'utf8')).replace(/\r\n/g, '\n');
await writeFile(appJs, src.replace('let total = subtotal() - state.discount;', 'let total = Math.max(0, subtotal() - state.discount);'));
const wrong = await tool('buggps_verify').execute({ case_id: 'coupon' }, exec());
if (wrong.status !== 'STILL_FAILING') throw new Error(`wrong fix: ${JSON.stringify(wrong)}`);
await card(`<div class="top">③ 修复 → 验证 Fix → verify<small>第一次修改看似合理，但没改到原因</small></div>
  <div class="term"><span class="dim">app.js</span>\n<span class="del">-  let total = subtotal() - state.discount;</span>\n<span class="add">+  let total = Math.max(0, subtotal() - state.discount);</span>\n\n<span class="dim">&gt; buggps_verify case_id=coupon</span>\n${term(textOf('buggps_verify', {}, wrong), ['expectation', 'before_fix', 'now', 'runs'])}</div>
  <div class="foot">原场景仍未满足预期 · The recorded scenario still fails</div>`, 4.4);

// ---------- scene 4: the real fix ----------
await writeFile(appJs, src.replace(/\/\/ SEEDED BUG 1: should call recompute\(\);[^\n]*\n\s*renderCart\(\);/, '      recompute();'));
const ok = await tool('buggps_verify').execute({ case_id: 'coupon' }, exec());
if (ok.status !== 'VERIFIED') throw new Error(`verify: ${JSON.stringify(ok)}`);
await card(`<div class="top">④ 再修 → 验证 Fix again → verify<small>完整录制 3 次通过观察窗口采样，独立基线对照重新出现原失败</small></div>
  <div class="term"><span class="dim">app.js</span>\n<span class="del">-      // SEEDED BUG 1: should call recompute(); …</span>\n<span class="del">-      renderCart();</span>\n<span class="add">+      recompute();</span>\n\n<span class="dim">&gt; buggps_verify case_id=coupon</span>\n${term(textOf('buggps_verify', {}, ok), ['binding', 'before_fix', 'now', 'runs', 'observed_for_ms', 'patch'])}</div>
  <div class="foot">补丁 = 锁定基线到这份代码的差异，已保存在 .buggps/runs/ · The patch is exactly baseline → this code</div>`, 5);

// ---------- scene 5: the fixed page ----------
const ctx = await env.browser.newContext({ viewport: { width: W, height: H } });
const p2 = await ctx.newPage();
await p2.goto(server.url);
await p2.addStyleTag({ content: PAGE_CSS });
for (const name of ['Add Apple', 'Add Banana']) await p2.getByRole('button', { name }).click();
await p2.getByRole('textbox', { name: 'Coupon' }).fill('SAVE10');
await p2.getByRole('button', { name: 'Apply coupon' }).click();
await p2.getByRole('button', { name: 'Remove Apple' }).click();
await draw(p2, { caption: '同样的操作，现在是 $18.00', sub: 'Same steps on the fixed code', highlight: await boxOf(p2.getByTestId('total')), ok: true, tag: '$18.00 ✓', step: '⑤ 结果 Result' });
await shot(p2, 2.4);
await ctx.close();

// ---------- scene 6: what else it catches + install ----------
await card(`<div class="hero"><p style="font-size:26px;font-weight:600">也会拦下这些“看起来修好了”</p>
  <p>· 服务器来源或基线不一致 → <code>PASSED_UNBOUND</code> / <code>NEEDS_REVIEW</code></p>
  <p>· 删掉功能让报错消失 → <code>NEEDS_REVIEW</code></p>
  <p>· 异常推迟到观察窗口内 → <code>STILL_FAILING</code></p>
  <p>· 禁用触发按钮 → <code>NEEDS_REVIEW</code></p>
  <p style="margin-top:28px;font-size:18px"><code>dsh plugin --profile &lt;profile&gt; add &lt;path-to-dsh-bug-gps&gt;</code></p>
</div>`, 4.2);

await dispose();

// ---------- encode ----------
await mkdir(OUT, { recursive: true });
const list = join(frameDir, 'list.txt');
await writeFile(list, `${frames.map((f) => `file '${f.file.replace(/\\/g, '/')}'\nduration ${f.seconds}`).join('\n')}\nfile '${frames.at(-1).file.replace(/\\/g, '/')}'\n`);
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const palette = join(frameDir, 'palette.png');
const mediaSeconds = Number(frames.reduce((s, f) => s + f.seconds, 0).toFixed(1));
ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=10,palettegen=max_colors=128:stats_mode=diff', palette]);
ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', palette, '-lavfi', 'fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', '-t', String(mediaSeconds), join(OUT, 'buggps-demo.gif')]);
ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', '-t', String(mediaSeconds), join(OUT, 'buggps-demo.mp4')]);
console.log(`frames: ${frames.length}, length: ${frames.reduce((s, f) => s + f.seconds, 0).toFixed(1)} s`);
console.log(`wrote ${join(OUT, 'buggps-demo.gif')} and buggps-demo.mp4`);
const caseDefinition = JSON.parse(await readFile(join(repo, '.buggps', 'cases', 'coupon', 'case.json'), 'utf8'));
const lockManifest = JSON.parse(await readFile(join(repo, '.buggps', 'cases', 'coupon', 'lock.json'), 'utf8'));
const verifiedRun = JSON.parse(await readFile(join(repo, ok.run_record), 'utf8'));
await writeFile(join(OUT, 'demo-run.json'), JSON.stringify({
  schema: 'buggps.demo/v1', kind: 'seeded-scripted-demo',
  engineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  generatorSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  caseSha256: lockManifest.caseSha256, lockSha256: hashLock(lockManifest), patchSha256: verifiedRun.patch.sha256,
  caseDefinition, environment: { browser: env.channel, version: env.version, node: process.version, platform: process.platform },
  recordedSteps: locked.recorded_steps, minimization: locked.minimization,
  wrongVerdict: wrong.status, correctedVerdict: ok.status, runs: ok.runs,
  observation: ok.observation,
  baselineControl: ok.baseline_control, mediaSeconds,
}, null, 2));
} finally {
  try { await dispose(); } finally {
    for (const [dir, prefix] of [[process.env.KEEP_FRAMES ? null : frameDir, 'buggps-frames-'], [repo, 'buggps-demo-']]) {
      if (!dir) continue;
      const target = await realpath(dir);
      if (dirname(target) !== await realpath(tmpdir()) || !basename(target).startsWith(prefix)) throw new Error('Unexpected demo cleanup path');
      await rm(target, { recursive: true, force: true });
    }
  }
}
