#!/usr/bin/env python3
"""Local OCR MCP Server backed by RapidOCR."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR

MCP_NAME = "ocr"
MCP_VERSION = "0.2.0"
ocr = RapidOCR()

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
    return any(resolved.startswith(base) for base in ALLOWED_DIRS)


def send_response(response: dict) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def send_error(request_id: int | str | None, code: int, message: str) -> None:
    send_response({"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": request_id})


def send_result(request_id: int | str | None, result: dict) -> None:
    send_response({"jsonrpc": "2.0", "result": result, "id": request_id})


def handle_initialize(request_id: int | str | None, params: dict) -> None:
    send_result(request_id, {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": MCP_NAME, "version": MCP_VERSION},
    })


def handle_tools_list(request_id: int | str | None, params: dict) -> None:
    send_result(request_id, {
        "tools": [
            {
                "name": "ocr_image",
                "description": "Extract text from an image using RapidOCR. Supports Chinese, English, and many other languages.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the image file.",
                        },
                    },
                    "required": ["path"],
                },
            }
        ]
    })


def handle_tool_call(request_id: int | str | None, params: dict) -> None:
    tool_name = params.get("name")
    arguments = params.get("arguments", {})
    if tool_name != "ocr_image":
        send_error(request_id, -32601, f"Unknown tool: {tool_name}")
        return

    path = arguments.get("path")
    if not path or not isinstance(path, str):
        send_error(request_id, -32602, "Missing required argument: path")
        return

    image_path = Path(path)
    if not image_path.exists():
        send_error(request_id, -32000, f"Image not found: {path}")
        return
    if not is_allowed(path):
        send_error(request_id, -32000, "Path not allowed by OCR MCP server policy")
        return

    try:
        result, elapse = ocr(str(image_path))
        texts = []
        if result:
            for item in result:
                if len(item) >= 2:
                    texts.append(item[1])
        text = "\n".join(texts)
        send_result(request_id, {
            "text": text,
            "path": str(image_path),
            "elapsed": elapse,
        })
    except Exception as exc:
        send_error(request_id, -32000, f"OCR failed: {exc}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = message.get("method")
        request_id = message.get("id")
        params = message.get("params", {})

        if method == "initialize":
            handle_initialize(request_id, params)
            send_response({"jsonrpc": "2.0", "method": "notifications/initialized"})
            continue
        if method == "tools/list":
            handle_tools_list(request_id, params)
            continue
        if method == "tools/call":
            handle_tool_call(request_id, params)
            continue

        send_error(request_id, -32601, f"Method not found: {method}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
