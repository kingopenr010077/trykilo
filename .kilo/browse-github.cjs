const { launch } = require('puppeteer');

(async () => {
  const browser = await launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    ignoreHTTPSErrors: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  try {
    await page.goto('https://github.com/kingopenr010077/trykilo/tree/session/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/.kilo/skills/rapid-ocr', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('page loaded:', await page.title());
    
    const text = await page.evaluate(() => document.body.innerText);
    console.log('body preview:', text.slice(0, 800));
    
    await page.screenshot({ path: '/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/.kilo/github-preview.png', fullPage: false });
    console.log('screenshot saved');
  } catch (e) {
    console.error('error:', e.message);
  } finally {
    await browser.close();
  }
})();
