#!/usr/bin/env python3
"""Direct OCR script using RapidOCR, no HTTP service required."""

import sys
from pathlib import Path

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    print("Error: rapidocr_onnxruntime not installed. Run: pip install rapidocr-onnxruntime", file=sys.stderr)
    sys.exit(1)

def ocr_image(image_path: str) -> str:
    """OCR an image and return extracted text."""
    ocr = RapidOCR()
    result, elapsed = ocr(image_path)
    if not result:
        return ""
    lines = []
    for item in result:
        if len(item) >= 2 and item[1]:
            lines.append(item[1])
    return "\n".join(lines)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python direct-ocr.py <image_path>", file=sys.stderr)
        sys.exit(1)
    
    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(f"Error: file not found: {image_path}", file=sys.stderr)
        sys.exit(1)
    
    text = ocr_image(image_path)
    print(text)
