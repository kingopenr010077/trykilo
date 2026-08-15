# trykilo

## Google MediaPipe 深度技术研究报告

> 基于源码级分析（master branch, 2026-08-15）

---

## 1. 项目概述

**MediaPipe** 是 Google 开源的跨平台实时流媒体机器学习框架，用于在移动设备、Web、桌面和边缘设备上部署端侧 ML 解决方案。

| 属性 | 详情 |
|------|------|
| **仓库** | `google-ai-edge/mediapipe` |
| **Stars** | 36.6k |
| **Forks** | 6.1k |
| **许可证** | Apache-2.0 |
| **Commits** | 5,586 |
| **主要语言** | C++（核心框架），Python/JavaScript/Java/Swift 绑定 |
| **构建系统** | Bazel |
| **状态** | 活跃开发（MediaPipe Solutions Preview） |

---

## 2. 核心定位

### 2.1 是什么

MediaPipe 是**端侧机器学习流水线框架**，核心价值是：

- **低延迟实时推理** — 在移动设备上实现实时（30fps+）ML 推理
- **跨平台一致性** — 同一套模型/逻辑在 Android、iOS、Web、桌面运行
- **可定制流水线** — 基于 Graph/Calculator 模型构建自定义 ML 流水线
- **即插即用解决方案** — MediaPipe Tasks 提供开箱即用的预置 API

### 2.2 不是什么

- **不是单一模型** — 它是框架 + 预置模型的集合
- **不是云服务** — 所有推理在设备端完成
- **不是训练框架** — 专注于推理部署，训练用 MediaPipe Model Maker

---

## 3. 深度架构分析

### 3.1 三层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3: MediaPipe Solutions（应用层）                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │   Vision    │  │    Text     │  │  Audio                      │  │
│  │  Solutions  │  │  Solutions  │  │  Solutions                  │  │
│  │             │  │             │  │                             │  │
│  │ • Face      │  │ • Text      │  │ • Audio                     │  │
│  │   Detection │  │   Classifier│  │   Classifier                │  │
│  │ • Hand      │  │ • LLM       │  │                             │  │
│  │   Tracking  │  │   Inference │  │                             │  │
│  │ • Pose      │  │             │  │                             │  │
│  │   Tracking  │  │             │  │                             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
│                                                                     │
│  提供形式：                                                          │
│  • MediaPipe Tasks（跨平台 API）                                     │
│  • MediaPipe Studio（浏览器可视化）                                  │
│  • MediaPipe Model Maker（模型定制）                                 │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: MediaPipe Tasks（中层 API）                               │
│                                                                     │
│  跨平台统一接口：                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │   C++ API   │  │   Python    │  │  JavaScript / WebAssembly    │  │
│  │             │  │    API      │  │                             │  │
│  │ tasks/c/    │  │ tasks/      │  │ tasks/web/                  │  │
│  │   vision    │  │  python/    │  │   vision                    │  │
│  │   text      │  │  vision     │  │   text                      │  │
│  │   audio     │  │  text       │  │   audio                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐                                   │
│  │   Java      │  │   Swift     │                                   │
│  │   (Android) │  │   (iOS)     │                                   │
│  └─────────────┘  └─────────────┘                                   │
│                                                                     │
│  核心能力：                                                          │
│  • 模型加载与管理                                                   │
│  • 推理执行                                                         │
│  • 结果后处理                                                       │
│  • 跨平台一致性抽象                                                 │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: MediaPipe Framework（底层框架）                           │
│                                                                     │
│  C++ 高性能流水线引擎                                               │
│                                                                     │
│  三大核心抽象：                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Graph（计算图）                                             │   │
│  │  • 声明式 ML 流水线定义                                      │   │
│  │  • 节点（Calculator） + 边（Packet Stream）                  │   │
│  │  • 序列化/反序列化                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Calculator（计算节点）                                      │   │
│  │  • 处理单元：输入 Packet → 输出 Packet                       │   │
│  │  • 分类：                                                    │   │
│  │    - core: 通用逻辑（constant, gate, split, merge）          │   │
│  │    - image: 图像处理（decode, resize, crop）                 │   │
│  │    - tensor: 张量操作（inference, pre/post-process）         │   │
│  │    - tflite: TensorFlow Lite 推理                            │   │
│  │    - audio: 音频处理                                         │   │
│  │    - video: 视频处理                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Packet（数据包）                                            │   │
│  │  • 带时间戳的不可变数据单元                                  │   │
│  │  • 类型：ImageFrame, AudioFrame, Tensor, 标量               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  附加能力：                                                          │
│  • GPU 加速（OpenGL/WebGL/Metal/WebGPU）                            │
│  • Profiler（性能分析）                                             │
│  • Stream Handler（输入源管理）                                      │
│  • 工具链（graph 可视化、转换）                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Framework 核心概念

**Packet（数据包）：**
```cpp
// 带时间戳的不可变数据单元
Packet packet = MakePacket<Tensor>(timestamp, tensor_data);
// 支持的类型：
// - ImageFrame（图像）
// - AudioFrame（音频）
// - Tensor（张量）
// - 标量（int, float, string）
```

**Graph（计算图）：**
```cpp
// 声明式定义
graph::CalculatorGraphConfig config;
config.add_input_stream("input_video");
config.add_input_stream("input_audio");

// 节点定义
auto* node = config.add_node();
node->set_calculator("FaceDetectionCpu");
node->add_input_stream("IMAGE:input_video");
node->add_output_stream("DETECTIONS:face_detections");

// 运行
CalculatorGraph graph;
graph.Initialize(config);
graph.StartRun();
graph.AddPacketToInputStream("input_video", timestamp, packet);
```

**Calculator（计算节点）：**
```cpp
class FaceDetectionCpuCalculator : public CalculatorBase {
  ::mediapipe::Status Open(CalculatorContext* cc) override;
  ::mediapipe::Status Process(CalculatorContext* cc) override;
  ::mediapipe::Status Close(CalculatorContext* cc) override;
};
```

### 3.3 预置 Graph 示例

| Graph | 用途 | 关键 Calculators |
|-------|------|------------------|
| `face_detection` | 人脸检测 | FaceDetectionCpu, TFLiteInference |
| `face_mesh` | 人脸网格（468点） | FaceLandmarkCpu, TFLiteInference |
| `hand_tracking` | 手部追踪（21点） | HandLandmarkCpu, PalmDetection |
| `pose_tracking` | 姿态估计（33点） | PoseLandmarkCpu, Blazepose |
| `holistic_tracking` | 全身（姿态+脸+手） | HolisticLandmarkCpu |
| `iris_tracking` | 眼球追踪 | IrisLandmarkCpu |
| `object_detection` | 物体检测 | ObjectDetectionCpu |
| `selfie_segmentation` | 人像分割 | SelfieSegmentationCpu |
| `hair_segmentation` | 头发分割 | HairSegmentationCpu |

---

## 4. MediaPipe Tasks API 深度解析

### 4.1 Vision Tasks

| Task | API 类 | 模型 | 输出 |
|------|--------|------|------|
| **Face Detector** | `FaceDetector` | BlazeFace | 人脸边界框 + 关键点 |
| **Face Landmarker** | `FaceLandmarker` | MediaPipe Face Mesh | 468 个面部关键点 + 面部几何 |
| **Hand Landmarker** | `HandLandmarker` | MediaPipe Hands | 每只手 21 个关键点 |
| **Pose Landmarker** | `PoseLandmarker` | BlazePose | 33 个身体关键点 |
| **Holistic Landmarker** | `HolisticLandmarker` | Holistic | 姿态 + 脸 + 手同时追踪 |
| **Gesture Recognizer** | `GestureRecognizer` | Gesture + Hand | 手势分类（握拳、点赞等） |
| **Object Detector** | `ObjectDetector` | EfficientNet/SSD | 物体检测 + 分类 |
| **Image Segmenter** | `ImageSegmenter` | SelfieSeg | 语义分割（人像/头发） |
| **Interactive Segmenter** | `InteractiveSegmenter` | SAM | 交互式分割（点选） |
| **Image Classifier** | `ImageClassifier` | MobileNet | 图像分类 |
| **Image Embedder** | `ImageEmbedder` | 各种 backbone | 图像特征向量 |

### 4.2 Text Tasks

| Task | API 类 | 模型 | 输出 |
|------|--------|------|------|
| **Text Classifier** | `TextClassifier` | BERT 等 | 文本分类 |
| **LLM Inference** | `LlmInference` | Gemma/Phi/Llama | 端侧 LLM 推理 |

### 4.3 Audio Tasks

| Task | API 类 | 模型 | 输出 |
|------|--------|------|------|
| **Audio Classifier** | `AudioClassifier` | YAMNet | 音频事件分类 |

### 4.4 Python API 示例

```python
import mediapipe as mp

# 初始化
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# 推理
image = cv2.imread("hand.jpg")
results = hands.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

# 结果
if results.multi_hand_landmarks:
    for hand_landmarks in results.multi_hand_landmarks:
        for landmark in hand_landmarks.landmark:
            print(f"{landmark.x}, {landmark.y}, {landmark.z}")
```

### 4.5 Tasks API（新一代）

```python
from mediapipe.tasks import vision

# 创建 ImageClassifier
classifier = vision.ImageClassifier.create_from_options(
    vision.ImageClassifierOptions(
        base_options=vision.BaseOptions(
            model_asset_path="mobilenet_v3.tflite"
        ),
        max_results=5,
    )
)

# 推理
image = vision.Image.from_file("cat.jpg")
result = classifier.classify(image)
print(result.classifications[0].categories)
```

---

## 5. 跨平台支持

### 5.1 平台矩阵

| 平台 | 技术栈 | 构建方式 |
|------|--------|----------|
| **Android** | Java/JNI + C++ | Gradle + Bazel |
| **iOS** | ObjC/Swift + C++ | Xcode + Bazel |
| **Web** | JavaScript + WebAssembly + WebGL | npm + pnpm |
| **Python** | C++ pybind11 | pip wheel |
| **C++** | 原生 | Bazel |
| **Edge/IoT** | C++ + Coral TPU | Bazel |

### 5.2 GPU 后端

| GPU 后端 | 平台 | 用途 |
|----------|------|------|
| **OpenGL** | Android, Desktop | 图像预处理 + 后处理 |
| **Metal** | iOS, macOS | 高性能 GPU 计算 |
| **WebGL** | Web | 浏览器 GPU 加速 |
| **WebGPU** | Web（新） | 下一代 Web GPU |
| **EGL** | Android/Linux | OpenGL 上下文管理 |

---

## 6. 关键特性

### 6.1 实时性能

- **移动端 30fps+** — 在旗舰手机上实时运行
- **低延迟** — 端侧推理，无需网络
- **高效内存** — 模型量化 + 内存复用

### 6.2 隐私保护

> When you use MediaPipe Tasks, processing of the input data (e.g. images, video, text) takes place on device, and MediaPipe does not send that input data to Google servers.

- 所有推理在设备端完成
- 数据不离开设备
- 仅发送匿名性能指标

### 6.3 可定制性

- **自定义模型** — MediaPipe Model Maker 支持在自定义数据上微调
- **自定义 Graph** — 基于 Framework 构建完全自定义的流水线
- **自定义 Calculator** — 可插入自定义处理节点

### 6.4 模型格式

- **TFLite** — 主要格式，支持量化
- **MediaPipe Model** — 封装格式，包含元数据
- **ONNX** — 通过转换支持

---

## 7. 项目结构

```
mediapipe/
├── mediapipe/
│   ├── framework/           # 底层框架
│   │   ├── api2/           # API v2（stream-based）
│   │   ├── api3/           # API v3（最新）
│   │   ├── formats/        # 数据格式（annotation, motion, tensor）
│   │   ├── port/           # 平台抽象层
│   │   ├── profiler/       # 性能分析器
│   │   ├── stream_handler/ # 输入流管理
│   │   └── tool/           # 工具链
│   ├── calculators/        # 计算节点
│   │   ├── core/          # 通用逻辑
│   │   ├── image/         # 图像处理
│   │   ├── tensor/        # 张量操作 + TFLite 推理
│   │   ├── tflite/        # TFLite 专用
│   │   ├── audio/         # 音频处理
│   │   ├── video/         # 视频处理
│   │   └── util/          # 工具
│   ├── graphs/            # 预置 Graph 配置
│   │   ├── face_detection/
│   │   ├── face_mesh/
│   │   ├── hand_tracking/
│   │   ├── pose_tracking/
│   │   ├── holistic_tracking/
│   │   └── ...
│   ├── modules/           # 核心模型模块
│   │   ├── face_detection/
│   │   ├── hand_landmark/
│   │   ├── pose_detection/
│   │   └── ...
│   ├── tasks/             # MediaPipe Tasks API
│   │   ├── c/            # C API
│   │   ├── cc/           # C++ API
│   │   ├── python/       # Python API
│   │   ├── java/         # Java API
│   │   ├── web/          # Web API
│   │   └── ios/          # iOS API
│   ├── gpu/              # GPU 抽象层
│   │   ├── webgpu/       # WebGPU 后端
│   │   ├── gl_calculator_helper.cc
│   │   └── ...
│   ├── model_maker/      # 模型定制工具
│   ├── examples/         # 示例应用
│   │   ├── android/
│   │   ├── ios/
│   │   ├── desktop/
│   │   └── web/
│   └── web/              # Web 运行时
│       └── graph_runner/ # Web 图执行器
├── docs/                 # 文档
├── third_party/          # 第三方依赖
│   ├── flatbuffers/
│   ├── halide/
│   ├── android/
│   └── ios/
├── setup.py              # Python 包配置
├── BUILD.bazel           # Bazel 构建入口
├── WORKSPACE             # Bazel workspace
└── MODULE.bazel          # Bazel module
```

---

## 8. 与同类框架对比

| 维度 | MediaPipe | OpenCV DNN | TensorFlow Lite | ONNX Runtime |
|------|-----------|------------|-----------------|--------------|
| **定位** | 实时流媒体 ML 流水线 | 通用计算机视觉 | 端侧推理引擎 | 跨框架推理引擎 |
| **核心抽象** | Graph/Calculator/Packet | Mat/Net | Graph/Interpreter | Session/Node |
| **实时性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **平台支持** | 移动/Web/桌面/边缘 | 全平台 | 移动/嵌入式 | 全平台 |
| **预置模型** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐ |
| **可定制性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **GPU 加速** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **学习曲线** | 陡峭 | 中等 | 中等 | 中等 |

---

## 9. 典型使用场景

### 9.1 移动应用

```java
// Android
FaceDetector detector = FaceDetector.createFromOptions(context,
    FaceDetectorOptions.builder()
        .setBaseOptions(BaseOptions.builder()
            .setModelAssetPath("face_detector.tflite")
            .build())
        .build());

InputImage image = InputImage.fromBitmap(bitmap);
List<Detection> results = detector.detect(image);
```

### 9.2 Web 应用

```javascript
// JavaScript + WebAssembly
const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
);
const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
        modelAssetPath: "face_detector.tflite"
    }
});
const result = detector.detect(image);
```

### 9.3 自定义 Graph

```cpp
// C++ 自定义流水线
CalculatorGraphConfig config;
config.add_input_stream("input_video");

auto* node = config.add_node();
node->set_calculator("FaceDetectionCpu");
node->add_input_stream("IMAGE:input_video");
node->add_output_stream("DETECTIONS:faces");

CalculatorGraph graph;
graph.Initialize(config);
graph.StartRun();
```

---

## 10. 与 notebooklm-py 的对比

| 维度 | MediaPipe | notebooklm-py |
|------|-----------|---------------|
| **类型** | 本地 ML 推理框架 | 云端 API 客户端 |
| **运行环境** | 设备端（手机/浏览器/桌面） | 需要网络 |
| **核心能力** | 实时视觉/音频/文本推理 | 文档分析 + 内容生成 |
| **延迟** | 毫秒级（本地） | 秒级（云端） |
| **隐私** | 数据不离设备 | 上传到 Google |
| **定制性** | 高（自定义模型/Graph） | 低（依赖 NotebookLM） |
| **模型大小** | 几 MB（量化 TFLite） | 无（云端推理） |
| **适用场景** | AR/VR、实时交互、隐私敏感 | 文档研究、内容生成 |

---

## 11. 核心优势

1. **真正的端侧 AI** — 数据不离设备，隐私合规
2. **实时性能** — 移动端 30fps+，延迟极低
3. **跨平台一致性** — 同一套模型在多个平台运行
4. **Google 维护** — 长期支持，持续更新
5. **丰富生态** — Tasks API + Model Maker + Studio
6. **开源可定制** — Apache-2.0，可深度修改

---

## 12. 限制与注意事项

1. **模型精度** — 端侧量化模型精度低于云端大模型
2. **硬件依赖** — 高性能功能需要 GPU/NPU
3. **构建复杂** — Bazel 构建系统学习曲线陡峭
4. **二进制体积** — 模型 + 运行时增加 App 体积
5. **平台差异** — 不同平台 GPU 驱动/驱动版本差异

---

## 13. 总结

MediaPipe 是 Google 在**端侧 AI 部署**领域的核心框架，核心价值是：

> **在资源受限的设备上，以实时性能运行高质量的机器学习模型**

它的三层架构（Framework → Tasks → Solutions）兼顾了灵活性和易用性：
- **Framework** 提供极致的定制能力
- **Tasks** 提供开箱即用的跨平台 API
- **Solutions** 提供预置的最佳实践

与 notebooklm-py 的本质区别：**MediaPipe 是本地推理引擎，notebooklm-py 是云端 API 客户端**。两者互补——MediaPipe 处理实时感知任务（视觉、音频），notebooklm-py 处理云端认知任务（文档理解、内容生成）。
