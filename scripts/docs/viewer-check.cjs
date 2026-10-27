// 骨格の記録の画面（/?skeleton=名）を Vite の開発サーバとヘッドレス Chromium で開き、記録ができるのを待って何日か進め、画面写しと集計とエラーを出す。
// 使い方: node scripts/docs/viewer-check.cjs 出力.png [設定の名 season-forest] [進める日数 3] [開く記録のファイル]
//   記録のファイルを渡すと、設定から作った記録を表示した後に、そのファイルを「記録のファイルを開く」で開き直して表示する。
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const REPO = require('node:path').resolve(__dirname, '../..');
const OUT = process.argv[2];
const NAME = process.argv[3] ?? 'season-forest';
const ADVANCE = Number(process.argv[4] ?? 3);
const FILE = process.argv[5];
const PORT = 5199;
(async () => {
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: REPO, detached: true, env: { ...process.env, PATH: `${process.env.HOME}/.local/node/bin:${process.env.PATH}` } });
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch {} };
  let log = '';
  vite.stdout.on('data', (d) => (log += d.toString()));
  vite.stderr.on('data', (d) => (log += d.toString()));
  const started = Date.now();
  while (!/127\.0\.0\.1:\d+/.test(log) && Date.now() - started < 60000) await new Promise((r) => setTimeout(r, 300));
  if (!/127\.0\.0\.1:\d+/.test(log)) { console.error('vite did not start:\n' + log); stop(); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/?skeleton=${NAME}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.village-specification', { timeout: 240000 });
  const ready = ((Date.now() - t0) / 1000).toFixed(1);
  if (FILE) {
    await page.setInputFiles('input[type=file]', FILE);
    await page.waitForSelector('.village-specification', { state: 'detached', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('.village-specification', { timeout: 240000 });
    console.log('opened file:', FILE, '→', await page.$eval('.e1-top h1', (e) => e.textContent));
  }
  for (let i = 0; i < ADVANCE; i++) { await page.getByRole('button', { name: '＋1日' }).click(); await page.waitForTimeout(300); }
  await page.waitForTimeout(500);
  const clock = await page.$eval('.e1-controls strong', (e) => e.textContent);
  const stats = await page.$eval('.e1-stats', (e) => e.textContent.replace(/\s+/g, ' '));
  const spec = await page.$$eval('.village-specification p', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 160)));
  const location = await page.$eval('.village-person-location', (e) => e.textContent).catch(() => '(none)');
  const forecastRows = await page.$$eval('[aria-label="見込みの表"] tbody tr', (els) => els.length).catch(() => 0);
  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`ready in ${ready}s, clock=${clock}`);
  console.log('stats:', stats);
  console.log('spec:', spec.join(' | '));
  console.log('selected:', location);
  console.log('forecast rows:', forecastRows);
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  stop();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
