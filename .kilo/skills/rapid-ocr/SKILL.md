# RapidOCR Skill

自动识别用户上传图片中的文字内容。

## 触发条件

当用户上传图片或要求"识别图片内容"、"OCR"、"图片里有什么文字"时触发。

## 执行步骤

1. 确认图片路径。用户上传的图片通常在：
   - `/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/` 目录下
   - 或 `/tmp/attachments/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/` 目录下

2. 调用本地 RapidOCR HTTP 服务：
   ```
   POST http://127.0.0.1:8765/ocr
   Content-Type: application/json
   
   {"path": "图片绝对路径"}
   ```

   或使用 multipart：
   ```
   POST http://127.0.0.1:8765/ocr
   Content-Type: multipart/form-data
   
   file=@图片绝对路径
   ```

3. 解析返回的 JSON，提取 `text` 字段。

4. 将识别到的文字内容返回给用户。

## 注意事项

- 如果本地服务（127.0.0.1:8765）不可用，提示用户启动服务：
  ```
  python3 /workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/.kilo/local-ocr-service.py
  ```
- 识别结果可能包含错误，特别是复杂排版或低分辨率图片。
- 支持中文、英文及混合文本。
