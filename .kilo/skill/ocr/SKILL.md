---
name: ocr
description: Perform OCR on image files using RapidOCR. Use this when the user provides an image and asks to extract text, read content from a screenshot/photo, or otherwise needs OCR. Supports common image formats including PNG, JPG, JPEG, BMP, TIFF.
---

# OCR Skill

Use `rapidocr_onnxruntime` to extract text from images.

## Setup (first run only)

```bash
python3 -c "from rapidocr_onnxruntime import RapidOCR; print('ready')"
```

If `libGL.so.1` is missing, install it:
```bash
apt-get update && apt-get install -y libgl1-mesa-glx
```

If the package is missing, install it:
```bash
apt-get update && apt-get install -y python3-pip && pip3 install rapidocr_onnxruntime
```

## Usage

Run OCR on an image file and return the extracted text:

```bash
python3 -c "from rapidocr_onnxruntime import RapidOCR; ocr = RapidOCR(); res, _ = ocr('IMAGE_PATH'); print('\n'.join([line[1] for line in res]) if res else 'No text detected')"
```

Replace `IMAGE_PATH` with the actual file path.

## Notes

- `res` is a list of tuples: `(bbox, text, confidence)`
- Extract text with `[line[1] for line in res]`
- If `res` is `None` or empty, output `No text detected`
- Always quote paths containing spaces or special characters
- For very long outputs, summarize the content rather than dumping raw text
