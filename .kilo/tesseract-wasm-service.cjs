const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');

const worker = createWorker();
const PORT = process.env.OCR_PORT || 8765;

const ALLOWED_DIRS = [
  "/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
  "/tmp/attachments/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
  "/tmp/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
];

function isAllowed(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith("/tmp/ocr_upload_")) return true;
  return ALLOWED_DIRS.some(dir => resolved.startsWith(dir));
}

async function ensureWorkerReady() {
  if (!worker._recognize) {
    await worker.load();
    await worker.loadLanguage('chi_sim+eng');
    await worker.initialize('chi_sim+eng');
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'tesseract-wasm' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/ocr') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const contentType = req.headers['content-type'] || '';
  let imagePath = null;

  if (contentType.includes('multipart/form-data')) {
    const boundary = contentType.split('boundary=')[1]?.trim();
    if (!boundary) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing boundary' }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    const delimiter = `--${boundary}`;
    const parts = data.toString('binary').split(delimiter);

    for (const part of parts) {
      if (!part.includes('name="file"')) continue;
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const header = part.slice(0, headerEnd);
      let filename = null;
      for (const line of header.split('\r\n')) {
        if (line.startsWith('filename=')) {
          filename = line.split('=')[1].replace(/"/g, '').trim();
          break;
        }
      }
      if (!filename) continue;
      const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
      imagePath = `/tmp/ocr_upload_${process.pid}_${Buffer.from(body).toString('base64').slice(0, 16)}`;
      fs.writeFileSync(imagePath, Buffer.from(body, 'binary'));
      break;
    }

    if (!imagePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing file field' }));
      return;
    }
  } else if (contentType.includes('application/json')) {
    const body = await new Promise(resolve => {
      const data = [];
      req.on('data', chunk => data.push(chunk));
      req.on('end', () => resolve(Buffer.concat(data).toString());
    });
    try {
      const json = JSON.parse(body);
      imagePath = json.path;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid json' }));
      return;
    }
  } else {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unsupported content type' }));
    return;
  }

  if (!isAllowed(imagePath) || !fs.existsSync(imagePath)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'path not allowed or file not found' }));
    return;
  }

  try {
    await ensureWorkerReady();
    const { data } = await worker.recognize(imagePath, { lang: 'chi_sim+eng' });
    const text = data.text;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ text, path: imagePath }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OCR service running on http://127.0.0.1:${PORT}`);
});
