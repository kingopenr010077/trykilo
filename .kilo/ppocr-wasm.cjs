const { launch } = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function ocrWithPpocr(imagePath) {
  const browser = await launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    ignoreHTTPSErrors: true
  });
  const page = await browser.newPage();

  try {
    await page.goto('https://ppocr.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('page loaded:', await page.title());

    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(imagePath);
    console.log('file uploaded');

    await new Promise(resolve => setTimeout(resolve, 5000));

    const resultSelectors = [
      '.result-text',
      '#result',
      'textarea',
      '.ocr-result',
      '.result'
    ];

    let text = '';
    for (const selector of resultSelectors) {
      const el = await page.$(selector);
      if (el) {
        text = await page.evaluate(node => node.value || node.innerText, el);
        if (text && text.trim()) {
          console.log(`found result in: ${selector}`);
          break;
        }
      }
    }

    const allText = await page.evaluate(() => document.body.innerText);
    console.log('body text preview:', allText.slice(0, 500));

    console.log(JSON.stringify({ text: text || allText, service: 'ppocr-wasm' }, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

const imagePath = process.argv[2];
if (!imagePath || !fs.existsSync(imagePath)) {
  console.error('Usage: node ppocr-wasm.cjs <image-path>');
  process.exit(1);
}

ocrWithPpocr(imagePath);
