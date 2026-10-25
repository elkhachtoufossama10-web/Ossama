// End-to-end smoke test: drives every panel in headless Chromium and saves screenshots.
// Usage: npm run build && npm start   (in another terminal)
//        node scripts/smoke-browser.cjs ./screenshots [http://localhost:8080]
// Needs Playwright (npm i -D playwright && npx playwright install chromium). Set HTTPS_PROXY if your network needs a proxy.
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || 'screenshots';
const base = process.argv[3] || 'http://localhost:8080/';
fs.mkdirSync(out, { recursive: true });
const proxyArgs = process.env.HTTPS_PROXY ? ['--proxy-server=' + process.env.HTTPS_PROXY, '--proxy-bypass-list=localhost;127.0.0.1'] : [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...proxyArgs] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-MA' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CORS') && !m.text().includes('ERR_FAILED')) errors.push('console: ' + m.text().slice(0, 200)); });
  const shot = async (n, el) => { await (el ? page.locator(el).screenshot({ path: `${out}/${n}.png` }) : page.screenshot({ path: `${out}/${n}.png` })); console.log('shot', n); };
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  // set a daytime instant over Africa/Europe: 2026-06-21 12:00 UTC  (via store: use the date input + time input)
  await page.fill('input[type=search]', 'طنجة');
  await page.waitForSelector('.search-list li', { timeout: 20000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.fill('input[type=date]', '2026-06-21');
  await page.fill('input[type=time]', '13:00');
  await page.waitForTimeout(6000);
  await shot('10-june-noon');
  await shot('11-sun-panel', '.side');
  // satellite overlay
  await page.selectOption('.layers fieldset:nth-of-type(2) select', 'MODIS_Terra_Cloud_Fraction_Day');
  await page.waitForTimeout(8000);
  await shot('12-gibs-cloud');
  await page.selectOption('.layers fieldset:nth-of-type(2) select', '');
  // model layer at a forecast time: now + 1 day
  await page.click('button.btn:has-text("الآن")');
  await page.click('button[aria-label="يوم للأمام"]');
  await page.selectOption('.layers fieldset:nth-of-type(3) select', 'temperature_2m');
  await page.waitForTimeout(25000);
  await shot('13-model-temp');
  await page.selectOption('.layers fieldset:nth-of-type(3) select', '');
  await page.click('button:has-text("الطبقات")');
  // weather & history tabs
  await page.click('button[data-tab=weather]');
  await page.waitForTimeout(8000);
  await shot('14-weather', '.side');
  await page.click('button[data-tab=history]');
  await page.waitForTimeout(8000);
  await page.click('button:has-text("تحميل المعدلات")');
  await page.waitForTimeout(25000);
  await shot('15-history', '.side');
  // seasons
  await page.fill('input[type=date]', '2026-06-21');
  await page.click('.nav button:nth-child(2)');
  await page.waitForTimeout(2500);
  await shot('16-seasons', '.side');
  await page.click('.nav button:nth-child(3)');
  await page.waitForTimeout(1500);
  await page.click('.presets button:nth-child(3)');
  await page.waitForTimeout(1500);
  await shot('17-tilt', '.side');
  await page.click('.nav button:nth-child(4)');
  await page.click('button:has-text("طنجة ↔ كيب تاون")');
  await page.waitForTimeout(8000);
  await shot('18-compare', '.side');
  await page.click('.nav button:nth-child(5)');
  await page.waitForTimeout(1500);
  await shot('19-sources', '.side');
  // orbit view
  await page.click('.view-toggle button:nth-child(2)');
  await page.waitForTimeout(2500);
  await shot('20-orbit');
  await page.click('.view-toggle button:nth-child(1)');
  // English
  await page.click('.nav button:nth-child(7)');
  await page.selectOption('.settings select >> nth=0', 'en');
  await page.click('.nav button:nth-child(1)');
  await page.waitForTimeout(4000);
  await shot('21-english');
  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-MA', isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(base, { waitUntil: 'load' });
  await mp.waitForTimeout(6000);
  await mp.screenshot({ path: `${out}/22-mobile.png` });
  await mp.screenshot({ path: `${out}/23-mobile-full.png`, fullPage: true });
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
