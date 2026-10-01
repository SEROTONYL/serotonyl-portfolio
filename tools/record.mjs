// Записывает короткие ролики с разделов для карточек на главной.
// Запуск: python3 -m http.server 8799 & node tools/record.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + '/.dev-browser/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:8799';
const OUT = process.env.OUT || 'tools/raw';
const pages = ['corridor', 'resume', 'request', 'seroconnect', 'vision'];
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
for (const name of pages) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: `${OUT}/${name}`, size: { width: 1280, height: 800 } },
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${name}/`, { waitUntil: 'networkidle' });
  await wait(2500);
  // плавный скролл и движение мыши, чтобы страница ожила
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(400 + i * 8, 300 + Math.sin(i / 6) * 120);
    await page.mouse.wheel(0, 40);
    await wait(80);
  }
  await wait(800);
  await ctx.close();
  console.log('ok', name);
}
await browser.close();
