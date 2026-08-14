const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function ocrWithWasm(imagePath) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://ppocr.com/', { waitUntil: 'networkidle', timeout: 60000 });
    
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(imagePath);
    
    await page.waitForTimeout(3000);
    
    const result = await page.locator('.result-text, #result, textarea, .ocr-result').first();
    const text = await result.textContent();
    
    console.log(JSON.stringify({ text: text || '', service: 'ppocr-wasm' }, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

const imagePath = process.argv[2];
if (!imagePath || !fs.existsSync(imagePath)) {
  console.error('Usage: node wasm-ocr.cjs <image-path>');
  process.exit(1);
}

ocrWithWasm(imagePath);
