const { launch } = require('puppeteer');

(async () => {
  const browser = await launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    ignoreHTTPSErrors: true
  });
  const page = await browser.newPage();
  await page.goto('https://ppocr.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.setViewport({ width: 1280, height: 720 });

  // Try clicking the upload area
  const uploadArea = await page.$('.upload-area, #upload, .drop-zone, [role="button"]');
  if (uploadArea) {
    await uploadArea.click();
    console.log('clicked upload area');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Set file input
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.uploadFile('/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/uploaded-image.jpg');
    console.log('file uploaded');
  }

  await new Promise(resolve => setTimeout(resolve, 12000));

  // Check for OCR results in various possible locations
  const result = await page.evaluate(() => {
    // Check for result textareas or divs
    const candidates = [];
    document.querySelectorAll('textarea, .result, .ocr-result, .result-text, #result, .output').forEach(el => {
      const text = (el.value || el.innerText || '').trim();
      if (text) candidates.push({ tag: el.tagName, class: el.className, text: text.slice(0, 200) });
    });
    
    // Check for any elements with Chinese text that appeared after upload
    const allElements = document.querySelectorAll('*');
    const chineseElements = [];
    for (const el of allElements) {
      const text = (el.innerText || '').trim();
      if (text.length > 10 && /[\u4e00-\u9fff]/.test(text) && text.length < 500) {
        chineseElements.push({ tag: el.tagName, class: el.className, text: text.slice(0, 200) });
      }
    }
    
    return { candidates, chineseElements: chineseElements.slice(0, 10) };
  });

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: '/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/ppocr-screen2.png' });
  console.log('screenshot saved');
  await browser.close();
})();
