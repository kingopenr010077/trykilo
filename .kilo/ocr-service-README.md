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

## 技术栈

- 引擎：RapidOCR（基于 ONNX Runtime）
- 服务：本地 Python HTTP 服务
- 语言支持：中文、英文及混合文本
- 网络：不需要，纯本地运行
