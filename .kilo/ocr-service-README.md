# OCR 服务使用文档

## 服务地址

```
http://127.0.0.1:8765
```

## 接口说明

### GET /health
健康检查。

返回：
```json
{"status":"ok","service":"rapidocr"}
```

### POST /ocr
OCR 识别。支持两种上传方式。

#### 方式一：JSON
```bash
curl -X POST http://127.0.0.1:8765/ocr \
  -H "Content-Type: application/json" \
  -d '{"path":"/path/to/image.jpg"}'
```

#### 方式二：multipart/form-data
```bash
curl -X POST http://127.0.0.1:8765/ocr \
  -F "file=@/path/to/image.jpg"
```

## 返回格式

```json
{
  "text": "识别到的文字内容",
  "path": "/tmp/ocr_upload_xxx",
  "elapsed": [1.29, 0.03, 1.02]
}
```

| 字段 | 说明 |
|------|------|
| `text` | 识别结果，多行用 `\n` 分隔 |
| `path` | 上传图片的临时路径 |
| `elapsed` | 各阶段耗时（秒） |

## 使用方式

你上传图片到会话，我直接调用上述接口进行 OCR，返回中文文字结果。

## 已跑通的方案汇总

### 方案一：本地 RapidOCR HTTP 服务（推荐）

- 地址：`http://127.0.0.1:8765`
- 接口：`GET /health`、`POST /ocr`
- 上传方式：JSON 或 multipart/form-data
- 技术栈：RapidOCR + ONNX Runtime，纯本地
- 优点：不需要网络，中文准确率高，延迟低
- 缺点：需要本地运行 Python 服务

### 方案二：OCR.space 匿名接口

- 地址：`POST https://api.ocr.space/parse/image`
- 认证：匿名 key `OCRonFrontpageOnly_26`
- 请求头：需带 `Origin: https://ocr.space`、`Referer: https://ocr.space/`、浏览器 `User-Agent`
- 支持：base64 或 multipart 上传
- 优点：不需要本地服务，有网络即可
- 缺点：质量中等，有速率限制，依赖网络

### 方案三：Puppeteer + ppocr.com

- 地址：`https://ppocr.com/`
- 技术栈：Puppeteer 控制 Chromium + 页面上的 WASM OCR
- 流程：打开网页 → 上传图片 → 等待识别 → 提取 `.text-content` textarea 结果
- 优点：基于 PaddleOCR v6，中文效果好
- 缺点：需要 Chromium + Puppeteer，依赖网络，速度较慢

## 技术栈

- 引擎：RapidOCR（基于 ONNX Runtime）
- 服务：本地 Python HTTP 服务
- 语言支持：中文、英文及混合文本
- 网络：不需要，纯本地运行
