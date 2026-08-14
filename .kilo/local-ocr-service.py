#!/usr/bin/env python3
"""本地 OCR HTTP 服务，基于 RapidOCR。"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

from http.server import BaseHTTPRequestHandler, HTTPServer
from rapidocr_onnxruntime import RapidOCR

OCR = RapidOCR()
ALLOWED_DIRS = [
    "/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
    "/tmp/attachments/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
    "/tmp/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13",
]


def is_allowed(path_str: str) -> bool:
    try:
        resolved = str(Path(path_str).resolve())
    except Exception:
        return False
    if resolved.startswith("/tmp/ocr_upload_"):
        return True
    return any(resolved.startswith(base) for base in ALLOWED_DIRS)


class OCRHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "service": "rapidocr"})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/ocr":
            self.send_json(404, {"error": "not found"})
            return

        content_type = self.headers.get("Content-Type", "")
        image_path: Optional[str] = None

        if "multipart/form-data" in content_type:
            form = self.parse_multipart()
            upload = form.get("file")
            if upload and upload.get("filename"):
                image_path = upload["path"]
            else:
                self.send_json(400, {"error": "missing file field"})
                return
        elif "application/json" in content_type:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_json(400, {"error": "invalid json"})
                return
            image_path = data.get("path")
            if not image_path:
                self.send_json(400, {"error": "missing path"})
                return
        else:
            self.send_json(415, {"error": "unsupported content type"})
            return

        if not is_allowed(image_path):
            self.send_json(403, {"error": "path not allowed"})
            return

        path = Path(image_path)
        if not path.exists():
            self.send_json(404, {"error": "image not found"})
            return

        try:
            result, elapse = OCR(str(path))
            texts = [item[1] for item in result] if result else []
            self.send_json(200, {"text": "\n".join(texts), "path": str(path), "elapsed": elapse})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def send_json(self, status_code: int, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def parse_multipart(self):
        content_type = self.headers.get("Content-Type", "")
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part.split("=", 1)[1].strip('"')
                break
        if not boundary:
            return {}

        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        delimiter = b"--" + boundary.encode()
        parts = data.split(delimiter)
        result = {}
        for part in parts:
            part = part.strip()
            if not part or part == b"--":
                continue
            if b"Content-Disposition" not in part:
                continue
            header_body = part.split(b"\r\n\r\n", 1)
            if len(header_body) != 2:
                continue
            header, body = header_body
            disposition = header.decode("utf-8", errors="ignore")
            if 'name="file"' not in disposition:
                continue
            filename = None
            for line in disposition.replace(";", "\r\n").split("\r\n"):
                line = line.strip()
                if line.startswith("filename="):
                    filename = line.split("=", 1)[1].strip('"')
                    break
            tmp_path = f"/tmp/ocr_upload_{os.getpid()}_{hash(body)}"
            Path(tmp_path).write_bytes(body.rstrip(b"\r\n"))
            result["file"] = {"filename": filename, "path": tmp_path}
        return result


def main():
    host = os.environ.get("OCR_HOST", "127.0.0.1")
    port = int(os.environ.get("OCR_PORT", "8765"))
    server = HTTPServer((host, port), OCRHandler)
    print(f"OCR service running on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
