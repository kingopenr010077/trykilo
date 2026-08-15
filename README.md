# trykilo

## 项目研究概览

本文档记录了三个与文档处理和 OCR 相关的开源项目的研究结果。

---

## 1. firecrawl/anydoc

**位置**: `firecrawl/anydoc`  
**语言**: Rust（核心）+ Node.js / Python / WebAssembly 绑定  
**许可证**: MIT  
**热度**: 16.1k stars, 890 forks

### 核心定位

将多种办公文档转换为干净的 GitHub-Flavored Markdown 的高性能 Rust 库。

### 支持的格式

| 类别 | 扩展名 |
|------|--------|
| Word | `.doc`, `.docx`, `.docm` |
| PowerPoint | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm` |
| Excel | `.xls`, `.xlsx`, `.xlsm`, `.xlsb` |
| OpenDocument | `.odt`, `.ods`, `.odp` |
| Rich Text Format | `.rtf` |
| EPUB | `.epub` |
| CSV | `.csv` |
| PDF | `.pdf` |

### 主要特性

- **统一输出**: 所有格式通过共享 Document Model 和 GFM Serializer 输出
- **内容检测**: 从文件内容而非扩展名检测格式
- **高性能**: 纯 Rust，中位转换时间 <5ms
- **Agent 集成**: 可作为 Agent Skill 使用
- **PDF 支持**: 仅支持文本型 PDF，无 OCR 能力

### 架构

```
文档字节 → 格式检测 → 格式解析器 → Document Model → GFM 序列化器 → Markdown
              ↓
           PDF → pdf-inspector → Markdown
```

### 性能基准

在 100 份真实文档（14 种格式）测试中：
- **综合得分**: 81/100（测试中最高）
- **中位转换时间**: 4.4ms
- **格式覆盖**: 14/14（唯一支持全部格式的工具）

### 使用方式

```bash
# CLI
npx @firecrawl/anydoc report.docx
npx @firecrawl/anydoc slides.pptx -o slides.md

# Node.js
npm install @firecrawl/anydoc
import { toMarkdown, toMarkdownBytes } from '@firecrawl/anydoc';

# Python
pip install firecrawl-anydoc
import anydoc
markdown = anydoc.to_markdown("report.docx")

# Rust
cargo add anydoc
let markdown = anydoc::to_markdown("report.docx")?;
```

### 限制

- **不支持网页/HTML 转换**
- **不支持 OCR**：仅处理文本型 PDF，扫描版 PDF 需要 Firecrawl 托管服务

---

## 2. Tencent-Hunyuan/HunyuanOCR

**位置**: `Tencent-Hunyuan/HunyuanOCR`  
**语言**: Python（训练/推理）  
**许可证**: Tencent Hunyuan Community License Agreement  
**热度**: 1.9k stars, 150 forks  
**论文**: arXiv:2607.04884

### 核心定位

腾讯混元团队开源的轻量化端到端 OCR 专用视觉语言模型（VLM），将文档解析、文字检测识别、信息抽取、图文翻译统一到单个模型中。

### 模型信息

- **参数量**: 1B
- **原始精度**: BF16
- **GGUF 量化大小估算**:
  - F16: ~2 GB（base + mmproj）
  - Q8_0: ~1.2 GB
  - Q6_K: ~1 GB
  - Q5_K_M: ~800 MB
  - Q4_K_M: ~600-700 MB
  - Q3_K_M: ~500 MB

### 主要特性

- **DFlash 推理加速**: 投机解码（speculative decoding），块扩散草稿模型并行起草候选 token
- **Agentic Data Flow**: 智能体驱动的数据构造系统，用于长尾能力补强
- **PC 端部署**: 支持 llama.cpp（CPU/消费级 GPU/笔记本）
- **统一推理**: 一套环境支持 vLLM AR、DFlash 投机解码、原生 transformers

### 任务类型（12种）

`doc_parse`, `structured_parse`, `spotting_json`, `spotting_hunyuan`, `layout`, `layout_parse`, `chart_parse`, `formula`, `table`, `doc_trans_en2zh`, `trans_other2en`, `trans_other2zh`

### 推理方式

#### A. vLLM（推荐，需 CUDA）

```bash
uv pip install "vllm>=0.25.1"
uv pip install --no-build-isolation --no-cache-dir "flash-attn==2.8.3"

MODEL_PATH=./HunyuanOCR GPU=0 PORT=8000 bash inference/vLLM/serve.sh
```

#### B. DFlash 投机解码

```bash
MODEL_PATH=./HunyuanOCR GPU=0 PORT=8000 bash inference/DFlash/serve_DFlash.sh
```

#### C. llama.cpp（PC 端/CPU）

```bash
# 1. 构建 llama.cpp
git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp
cmake -B build -DLLAMA_BUILD_EXAMPLES=ON
cmake --build ./build --config Release -j

# 2. 转换权重
python3 convert_hf_to_gguf.py --outfile ./HunyuanOCR/hyocr-f16.gguf --outtype f16 ./HunyuanOCR
python3 convert_hf_to_gguf.py --outfile ./HunyuanOCR/mmproj-hyocr-f16.gguf --outtype f16 --mmproj ./HunyuanOCR

# 3. 启动服务
build/bin/llama-server \
    --model ./HunyuanOCR/hyocr-f16.gguf \
    --mmproj ./HunyuanOCR/mmproj-hyocr-f16.gguf \
    --host 0.0.0.0 --port 8080 --alias HYVL \
    --ctx-size 10240 --n-predict 4096
```

### 使用限制

- **手机端**: 未官方支持。理论上高配手机可用 llama.cpp + Q3/Q4 量化运行，但体验会很差（内存不足、速度慢）
- **PC 端**: 官方支持 llama.cpp 部署，推荐 CPU/消费级 GPU/笔记本环境
- **服务器端**: 推荐 vLLM 部署，需要 NVIDIA GPU（CUDA 12.1+）

---

## 3. teng-lin/notebooklm-py

**位置**: `teng-lin/notebooklm-py`  
**语言**: Python  
**许可证**: MIT  
**热度**: 18.7k stars, 2.5k forks  
**注意**: 非官方库，使用 Google 未公开 API

### 核心定位

Google NotebookLM（Gemini Notebook）的非官方 Python API 和 Agent 技能包，提供完整的程序化访问能力。

### 主要功能

| 类别 | 能力 |
|------|------|
| **笔记本管理** | 创建、列表、重命名、删除 |
| **来源管理** | URLs、YouTube、PDF、Word、EPUB、音频、视频、图片、Google Drive |
| **聊天问答** | 基于来源的问答、对话历史、自定义 persona |
| **内容生成** | 音频概览、视频、幻灯片、信息图、测验、抽认卡、报告、数据表、思维导图 |
| **下载导出** | MP3、MP4、PDF、PNG、CSV、JSON、Markdown、PPTX |
| **研究代理** | Web 和 Drive 研究代理（快速/深度模式） |

### 使用方式

#### CLI

```bash
uv tool install "notebooklm-py[browser]"
notebooklm login
notebooklm create "My Research"
notebooklm source add "https://example.com"
notebooklm source add "./paper.pdf"
notebooklm ask "What are the key themes?"
notebooklm generate audio "make it engaging" --wait
notebooklm download audio ./podcast.m4a
```

#### Python API

```python
import asyncio
from notebooklm import NotebookLMClient

async def main():
    async with NotebookLMClient.from_storage() as client:
        nb = await client.notebooks.create("Research")
        await client.sources.add_url(nb.id, "https://example.com", wait=True)
        result = await client.chat.ask(nb.id, "Summarize this")
        print(result.answer)

asyncio.run(main())
```

#### Agent 集成

```bash
notebooklm skill install
# 或
npx skills add teng-lin/notebooklm-py
```

### 认证方式

- Playwright 交互式登录
- 从已登录浏览器导入 cookies
- Master token（无头服务器自愈）

### 限制

- **非官方**：使用 Google 内部 API，随时可能失效
- **需要 Google 账号**
- **有速率限制**：大量使用可能被限流

---

## 工具对比与选型建议

| 需求 | 推荐工具 | 原因 |
|------|----------|------|
| 批量转换办公文档为 Markdown | anydoc | 纯本地、极快、14种格式统一输出 |
| 扫描版 PDF/图片 OCR | HunyuanOCR | 端到端 OCR VLM，支持复杂文档 |
| 基于文档的问答/研究 | notebooklm-py | 利用 Gemini 的 grounded 推理能力 |
| 手机端 OCR | 暂不推荐 | 无成熟方案，需等待端侧优化 |
| 纯 CPU 部署 | HunyuanOCR (llama.cpp) | 官方支持 PC 端 CPU 推理 |

---

## 典型工作流

```
输入: 扫描版 PDF / 图片文档
    ↓
[OCR] HunyuanOCR (llama.cpp, CPU)
    ↓
输出: 文本/Markdown
    ↓
[问答/研究] notebooklm-py (Gemini Notebook)
    ↓
输出: 结构化答案、音频、测验等
```

```
输入: 办公文档（Word/Excel/PPT/PDF）
    ↓
[文档转换] anydoc
    ↓
输出: Markdown
    ↓
[可选: 进一步分析] notebooklm-py
```
