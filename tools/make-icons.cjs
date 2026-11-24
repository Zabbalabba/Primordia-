// Renders icons/*.png from tools/icons.html with Playwright.
// Usage: serve the repository root (npm run serve), then: node tools/make-icons.cjs [http://localhost:8080]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = process.argv[2] || 'http://localhost:8080';
  const out = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${base}/tools/icons.html`);
  await page.waitForFunction(() => window.iconsReady === true);
  for (const size of [32, 180, 192, 512]) {
    const data = await page.evaluate((s) => window.renderIcon(s), size);
    fs.writeFileSync(path.join(out, `icon-${size}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  await browser.close();
  console.log('icons written to', out);
})();
