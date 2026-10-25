// Start the Vite dev server, open skeleton.html in headless Chromium, advance a few days, screenshot, report console errors, stop the server.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const REPO = require('node:path').resolve(__dirname, '../..');
const OUT = process.argv[2];
const PORT = 5199;
(async () => {
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: REPO, env: { ...process.env, PATH: `${process.env.HOME}/.local/node/bin:${process.env.PATH}` } });
  let log = '';
  vite.stdout.on('data', (d) => (log += d.toString()));
  vite.stderr.on('data', (d) => (log += d.toString()));
  const started = Date.now();
  while (!/127\.0\.0\.1:\d+/.test(log) && Date.now() - started < 60000) await new Promise((r) => setTimeout(r, 300));
  if (!/127\.0\.0\.1:\d+/.test(log)) { console.error('vite did not start:\n' + log); vite.kill(); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${PORT}/skeleton.html?persons=2&sight=60`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#map');
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) await page.click('#day');
  await page.waitForTimeout(500);
  const time = await page.$eval('#time', (e) => e.textContent);
  const rows = await page.$$eval('#daily tbody tr', (els) => els.length);
  const kinds = await page.$$eval('#kinds h3', (els) => els.map((e) => e.textContent));
  const counts = await page.$eval('#counts', (e) => e.textContent.slice(0, 200));
  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`time=${time} dailyRows=${rows} kinds=${kinds.join(' | ')}`);
  console.log('counts:', counts.replace(/\s+/g, ' '));
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
