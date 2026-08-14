# RapidOCR Skill

自动识别用户上传图片中的文字内容。

## 触发条件

当用户上传图片或要求"识别图片内容"、"OCR"、"图片里有什么文字"时触发。

## 执行步骤

1. 确认图片路径。用户上传的图片通常在：
   - `/workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/` 目录下
   - 或 `/tmp/attachments/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/` 目录下

2. 直接调用 RapidOCR 脚本：
   ```bash
   python3 /workspace/f0ffdb59-face-4ed4-a273-570a0b2c1492/sessions/agent_93fbf0c0-d1b4-4fcd-9129-710a419d1b13/.kilo/skills/rapid-ocr/direct-ocr.py "图片绝对路径"
   ```

3. 将脚本输出的文字内容返回给用户。

## 注意事项

- 依赖 `rapidocr-onnxruntime`，如果未安装会提示安装命令。
- 识别结果可能包含错误，特别是复杂排版或低分辨率图片。
- 支持中文、英文及混合文本。
- 不需要 HTTP 服务，不需要网络。
