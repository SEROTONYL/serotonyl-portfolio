// Снимает og.png и apple-touch-icon.png из og.html и icon.html.
const { chromium } = require(require('os').homedir() + '/.dev-browser/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const [f, w, h, out] of [['og.html', 1200, 630, 'og.png'], ['icon.html', 180, 180, 'apple-touch-icon.png']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file://' + path.join(__dirname, f));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(__dirname, out) });
  }
  await b.close();
})();
