import * as ort from "onnxruntime-web";
//#region src/utils/math.ts
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function roundUpToMultiple(value, multiple) {
	return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}
function sortBoxes(boxes) {
	return [...boxes].sort((left, right) => {
		const ly = left.points[0].y;
		const ry = right.points[0].y;
		if (Math.abs(ly - ry) > 12) return ly - ry;
		return left.points[0].x - right.points[0].x;
	});
}
function axisAlignedBounds(box) {
	const xs = box.points.map((point) => point.x);
	const ys = box.points.map((point) => point.y);
	const left = Math.min(...xs);
	const right = Math.max(...xs);
	const top = Math.min(...ys);
	const bottom = Math.max(...ys);
	return {
		left,
		top,
		width: right - left,
		height: bottom - top
	};
}
function maxIndex(values) {
	let index = 0;
	let value = values[0] ?? Number.NEGATIVE_INFINITY;
	for (let cursor = 1; cursor < values.length; cursor += 1) if (values[cursor] > value) {
		index = cursor;
		value = values[cursor];
	}
	return {
		index,
		value
	};
}
function maxProbability(values) {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (let cursor = 0; cursor < values.length; cursor += 1) {
		const value = values[cursor];
		if (value < min) min = value;
		if (value > max) max = value;
	}
	if (min >= 0 && max <= 1) return max;
	let total = 0;
	for (let cursor = 0; cursor < values.length; cursor += 1) total += Math.exp(values[cursor] - max);
	return 1 / total;
}
//#endregion
//#region src/io/canvas.ts
function hasOffscreenCanvas() {
	return typeof OffscreenCanvas !== "undefined";
}
function isImageData(value) {
	return typeof ImageData !== "undefined" && value instanceof ImageData;
}
function isImageBitmap(value) {
	return typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap;
}
function isHtmlImageElement(value) {
	return typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement;
}
function isHtmlCanvasElement(value) {
	return typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement;
}
function isOffscreenCanvas(value) {
	return hasOffscreenCanvas() && value instanceof OffscreenCanvas;
}
function createCanvas(width, height) {
	if (hasOffscreenCanvas()) return new OffscreenCanvas(width, height);
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	throw new Error("A canvas implementation is required in this runtime.");
}
function getContext(canvas) {
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Unable to create a 2D canvas context.");
	return context;
}
async function loadImageFromUrl(url) {
	if (typeof createImageBitmap !== "undefined") {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch image from ${url}`);
		const blob = await response.blob();
		return createImageBitmap(blob);
	}
	if (typeof Image === "undefined") throw new Error("This runtime cannot load URL inputs.");
	return await new Promise((resolve, reject) => {
		const image = new Image();
		image.crossOrigin = "anonymous";
		image.onload = () => resolve(image);
		image.onerror = () => reject(/* @__PURE__ */ new Error(`Failed to load image from ${url}`));
		image.src = url;
	});
}
async function blobToImage(blob) {
	if (typeof createImageBitmap !== "undefined") return createImageBitmap(blob);
	const url = URL.createObjectURL(blob);
	try {
		return await loadImageFromUrl(url);
	} finally {
		URL.revokeObjectURL(url);
	}
}
function drawIntoImageData(source) {
	const width = isHtmlImageElement(source) ? source.naturalWidth || source.width : source.width;
	const height = isHtmlImageElement(source) ? source.naturalHeight || source.height : source.height;
	const context = getContext(createCanvas(width, height));
	context.drawImage(source, 0, 0, width, height);
	return context.getImageData(0, 0, width, height);
}
async function ensureImageData(source) {
	if (isImageData(source)) return source;
	if (isHtmlCanvasElement(source) || isOffscreenCanvas(source)) return getContext(source).getImageData(0, 0, source.width, source.height);
	if (isImageBitmap(source) || isHtmlImageElement(source)) return drawIntoImageData(source);
	if (typeof source === "string") return drawIntoImageData(await loadImageFromUrl(source));
	if (source instanceof Blob) return drawIntoImageData(await blobToImage(source));
	throw new Error("Unsupported image source.");
}
function resizeImageData(source, width, height) {
	const inputCanvas = createCanvas(source.width, source.height);
	getContext(inputCanvas).putImageData(source, 0, 0);
	const outputContext = getContext(createCanvas(width, height));
	outputContext.drawImage(inputCanvas, 0, 0, width, height);
	return outputContext.getImageData(0, 0, width, height);
}
function cropImageData(source, left, top, width, height) {
	const x = clamp(Math.floor(left), 0, source.width - 1);
	const y = clamp(Math.floor(top), 0, source.height - 1);
	const w = clamp(Math.ceil(width), 1, source.width - x);
	const h = clamp(Math.ceil(height), 1, source.height - y);
	const pixels = new Uint8ClampedArray(w * h * 4);
	for (let row = 0; row < h; row += 1) {
		const sourceOffset = ((y + row) * source.width + x) * 4;
		const targetOffset = row * w * 4;
		pixels.set(source.data.subarray(sourceOffset, sourceOffset + w * 4), targetOffset);
	}
	return new ImageData(pixels, w, h);
}
//#endregion
//#region src/runtime/ort.ts
let configured = false;
function configureOrt(options) {
	if (configured || !options) return;
	if (options.wasmPaths) ort.env.wasm.wasmPaths = options.wasmPaths;
	if (options.wasmThreads) ort.env.wasm.numThreads = options.wasmThreads;
	configured = true;
}
const MODEL_CACHE_NAME = "ffocr-models";
async function readResponseWithProgress(response, onProgress) {
	if (!onProgress || !response.body) return response.arrayBuffer();
	const contentLength = response.headers.get("content-length");
	const total = contentLength ? parseInt(contentLength, 10) : void 0;
	const reader = response.body.getReader();
	const chunks = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.byteLength;
		onProgress(loaded, total);
	}
	const result = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result.buffer;
}
async function fetchWithProgress(url, onProgress, useCache) {
	if (useCache && typeof caches !== "undefined") {
		const cache = await caches.open(MODEL_CACHE_NAME);
		const cached = await cache.match(url);
		if (cached) return readResponseWithProgress(cached, onProgress);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
		const cloned = response.clone();
		cache.put(url, cloned);
		return readResponseWithProgress(response, onProgress);
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
	return readResponseWithProgress(response, onProgress);
}
async function createSession(url, provider, onDownloadProgress, useCache) {
	const data = await fetchWithProgress(url, onDownloadProgress, useCache);
	return ort.InferenceSession.create(data, {
		executionProviders: [provider],
		graphOptimizationLevel: "all"
	});
}
async function runSession(session, data, dims, inputName, outputName) {
	const feeds = { [inputName ?? session.inputNames[0]]: new ort.Tensor("float32", data, dims) };
	const output = (await session.run(feeds))[outputName ?? session.outputNames[0]];
	if (!output) throw new Error("ONNX Runtime returned no matching output tensor.");
	return output;
}
//#endregion
//#region src/runtime/provider.ts
const EXECUTION_PROVIDER_PRIORITY = [
	"webgpu",
	"webnn",
	"webgl",
	"wasm"
];
function normalizePreference(preference) {
	if (!preference || preference === "auto") {
		const available = getAvailableExecutionProviders();
		return available.length > 0 ? available : ["wasm"];
	}
	if (typeof preference === "string") return [preference];
	return [...preference];
}
function getProviderCandidates(preference) {
	return normalizePreference(preference).filter((value, index, array) => array.indexOf(value) === index);
}
function getKnownExecutionProviders() {
	return EXECUTION_PROVIDER_PRIORITY;
}
function getExecutionProviderSupport() {
	return EXECUTION_PROVIDER_PRIORITY.map((provider) => ({
		provider,
		available: isExecutionProviderAvailable(provider)
	}));
}
function getAvailableExecutionProviders() {
	return getExecutionProviderSupport().filter((item) => item.available).map((item) => item.provider);
}
function isExecutionProviderAvailable(provider) {
	switch (provider) {
		case "webgpu": return supportsWebGpu();
		case "webnn": return supportsWebNN();
		case "webgl": return supportsWebGl();
		case "wasm": return supportsWasm();
		default: return false;
	}
}
function supportsWebGpu() {
	return typeof navigator !== "undefined" && "gpu" in navigator;
}
function supportsWebNN() {
	return typeof navigator !== "undefined" && "ml" in navigator;
}
function supportsWebGl() {
	const canvas = createProbeCanvas();
	if (!canvas) return false;
	try {
		if (canvas.getContext("webgl2") || canvas.getContext("webgl")) return true;
		return typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement ? Boolean(canvas.getContext("experimental-webgl")) : false;
	} catch {
		return false;
	}
}
function supportsWasm() {
	return typeof WebAssembly !== "undefined";
}
function createProbeCanvas() {
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1);
	if (typeof document !== "undefined") return document.createElement("canvas");
	return null;
}
//#endregion
//#region src/pipeline/detect.ts
function createAxisAlignedBox(component, options) {
	const width = component.maxX - component.minX + 1;
	const height = component.maxY - component.minY + 1;
	const score = component.scoreSum / component.pixels;
	if (width < options.minSize || height < options.minSize || score < options.boxThreshold) return null;
	const distance = width * height * options.unclipRatio / Math.max(2 * (width + height), 1);
	const left = clamp(component.minX - distance, 0, options.resizedWidth - 1);
	const top = clamp(component.minY - distance, 0, options.resizedHeight - 1);
	const right = clamp(component.maxX + distance, 0, options.resizedWidth - 1);
	const bottom = clamp(component.maxY + distance, 0, options.resizedHeight - 1);
	const scaleX = options.sourceWidth / options.resizedWidth;
	const scaleY = options.sourceHeight / options.resizedHeight;
	return {
		score,
		points: [
			{
				x: left * scaleX,
				y: top * scaleY
			},
			{
				x: right * scaleX,
				y: top * scaleY
			},
			{
				x: right * scaleX,
				y: bottom * scaleY
			},
			{
				x: left * scaleX,
				y: bottom * scaleY
			}
		]
	};
}
function normalizeProbabilityMap(raw, dims) {
	if (dims.length === 4) return {
		map: raw,
		height: dims[2] ?? 0,
		width: dims[3] ?? 0
	};
	if (dims.length === 3) return {
		map: raw,
		height: dims[1] ?? 0,
		width: dims[2] ?? 0
	};
	throw new Error(`Unsupported detection output shape: ${dims.join("x")}`);
}
function postprocessDetection(raw, dims, options) {
	const { map, height, width } = normalizeProbabilityMap(raw, dims);
	const visited = new Uint8Array(width * height);
	const queue = new Uint32Array(width * height);
	const results = [];
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const root = y * width + x;
		if (visited[root] || map[root] < options.threshold) continue;
		let head = 0;
		let tail = 0;
		let component = {
			minX: x,
			minY: y,
			maxX: x,
			maxY: y,
			pixels: 0,
			scoreSum: 0
		};
		visited[root] = 1;
		queue[tail] = root;
		tail += 1;
		while (head < tail) {
			const current = queue[head];
			head += 1;
			const cx = current % width;
			const cy = Math.floor(current / width);
			component.minX = Math.min(component.minX, cx);
			component.minY = Math.min(component.minY, cy);
			component.maxX = Math.max(component.maxX, cx);
			component.maxY = Math.max(component.maxY, cy);
			component.pixels += 1;
			component.scoreSum += map[current];
			for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
				if (ny < 0 || ny >= height) continue;
				for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
					if (nx < 0 || nx >= width) continue;
					const next = ny * width + nx;
					if (visited[next] || map[next] < options.threshold) continue;
					visited[next] = 1;
					queue[tail] = next;
					tail += 1;
				}
			}
		}
		const box = createAxisAlignedBox(component, options);
		if (box) results.push(box);
	}
	return results;
}
//#endregion
//#region src/pipeline/preprocess.ts
const DET_MEAN_BGR = [
	.485,
	.456,
	.406
];
const DET_STD_BGR = [
	.229,
	.224,
	.225
];
function preprocessDetection(source, limitSideLen) {
	const maxSide = Math.max(source.width, source.height);
	const scale = maxSide > limitSideLen ? limitSideLen / maxSide : 1;
	const resizedWidth = roundUpToMultiple(Math.max(32, Math.round(source.width * scale)), 32);
	const resizedHeight = roundUpToMultiple(Math.max(32, Math.round(source.height * scale)), 32);
	const resized = resizeImageData(source, resizedWidth, resizedHeight);
	const tensor = new Float32Array(3 * resizedWidth * resizedHeight);
	for (let y = 0; y < resizedHeight; y += 1) for (let x = 0; x < resizedWidth; x += 1) {
		const pixelOffset = (y * resizedWidth + x) * 4;
		const red = resized.data[pixelOffset] / 255;
		const green = resized.data[pixelOffset + 1] / 255;
		const blue = resized.data[pixelOffset + 2] / 255;
		const spatialOffset = y * resizedWidth + x;
		tensor[spatialOffset] = (blue - DET_MEAN_BGR[0]) / DET_STD_BGR[0];
		tensor[resizedWidth * resizedHeight + spatialOffset] = (green - DET_MEAN_BGR[1]) / DET_STD_BGR[1];
		tensor[2 * resizedWidth * resizedHeight + spatialOffset] = (red - DET_MEAN_BGR[2]) / DET_STD_BGR[2];
	}
	return {
		data: tensor,
		dims: [
			1,
			3,
			resizedHeight,
			resizedWidth
		],
		resizedWidth,
		resizedHeight
	};
}
function preprocessRecognition(source, imageShape) {
	const [, targetHeight, targetWidth] = imageShape;
	const ratio = source.width / Math.max(source.height, 1);
	const resizedWidth = Math.min(targetWidth, Math.max(1, Math.round(targetHeight * ratio)));
	const resized = resizeImageData(source, resizedWidth, targetHeight);
	const tensor = new Float32Array(3 * targetHeight * targetWidth);
	for (let y = 0; y < targetHeight; y += 1) for (let x = 0; x < targetWidth; x += 1) {
		const spatialOffset = y * targetWidth + x;
		const channelOffset = spatialOffset;
		if (x < resizedWidth) {
			const pixelOffset = (y * resizedWidth + x) * 4;
			tensor[channelOffset] = resized.data[pixelOffset + 2] / 127.5 - 1;
			tensor[targetHeight * targetWidth + spatialOffset] = resized.data[pixelOffset + 1] / 127.5 - 1;
			tensor[2 * targetHeight * targetWidth + spatialOffset] = resized.data[pixelOffset] / 127.5 - 1;
		} else {
			tensor[channelOffset] = 0;
			tensor[targetHeight * targetWidth + spatialOffset] = 0;
			tensor[2 * targetHeight * targetWidth + spatialOffset] = 0;
		}
	}
	return {
		data: tensor,
		dims: [
			1,
			3,
			targetHeight,
			targetWidth
		]
	};
}
//#endregion
//#region src/pipeline/recognize.ts
function decodeRecognitionOutput(output, dims, dictionary, options = {}) {
	if (dims.length !== 3) throw new Error(`Unsupported recognition output shape: ${dims.join("x")}`);
	const [batch, second, third] = dims;
	const blankIndex = options.blankIndex ?? 0;
	const isBatchTimeClass = second < third;
	const timeSteps = isBatchTimeClass ? second : third;
	const classes = isBatchTimeClass ? third : second;
	const results = [];
	for (let batchIndex = 0; batchIndex < batch; batchIndex += 1) {
		let lastIndex = -1;
		const pieces = [];
		const confidences = [];
		for (let step = 0; step < timeSteps; step += 1) {
			const logits = new Float32Array(classes);
			for (let classIndex = 0; classIndex < classes; classIndex += 1) logits[classIndex] = output[isBatchTimeClass ? (batchIndex * timeSteps + step) * classes + classIndex : (batchIndex * classes + classIndex) * timeSteps + step];
			const prediction = maxIndex(logits);
			if (prediction.index === blankIndex || prediction.index === lastIndex) {
				lastIndex = prediction.index;
				continue;
			}
			const token = dictionary[prediction.index - 1];
			if (token) {
				pieces.push(token);
				confidences.push(maxProbability(logits));
			}
			lastIndex = prediction.index;
		}
		const score = confidences.length === 0 ? 0 : confidences.reduce((total, value) => total + value, 0) / confidences.length;
		results.push({
			text: pieces.join(""),
			score
		});
	}
	return results;
}
//#endregion
//#region src/paddle-ocr.ts
const DEFAULT_RECOGNITION_SHAPE = [
	3,
	48,
	320
];
function isDictionaryUrlSource(source) {
	return !Array.isArray(source);
}
async function loadDictionary(source) {
	if (!isDictionaryUrlSource(source)) return [...source];
	const response = await fetch(source.url);
	if (!response.ok) throw new Error(`Unable to fetch dictionary from ${source.url}`);
	const lines = (await response.text()).split(/\r?\n/u);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}
function createBlankTensor(width, height) {
	return new Float32Array(3 * width * height);
}
function combineRecognitionBatch(batch, shape) {
	const [channels, height, width] = shape;
	const itemSize = channels * height * width;
	const merged = new Float32Array(batch.length * itemSize);
	batch.forEach((tensor, index) => {
		merged.set(tensor, index * itemSize);
	});
	return merged;
}
var PaddleOcrWeb = class {
	options;
	detectorSession = null;
	recognizerSession = null;
	dictionary = [];
	runtimeSelection = null;
	initPromise = null;
	constructor(options) {
		this.options = options;
	}
	async init(onProgress) {
		if (!this.initPromise) this.initPromise = this.doInit(onProgress);
		return this.initPromise;
	}
	async doInit(onProgress) {
		configureOrt(this.options.ort);
		onProgress?.({ phase: "loading_dictionary" });
		this.dictionary = await loadDictionary(this.options.manifest.dictionary);
		const provider = await this.selectProvider();
		const useCache = this.options.cacheModels;
		onProgress?.({ phase: "loading_detection_model" });
		this.detectorSession = await createSession(this.options.manifest.detection.url, provider, onProgress ? (loaded, totalBytes) => onProgress({
			phase: "loading_detection_model",
			loaded,
			totalBytes: totalBytes ?? void 0
		}) : void 0, useCache);
		onProgress?.({ phase: "loading_recognition_model" });
		this.recognizerSession = await createSession(this.options.manifest.recognition.url, provider, onProgress ? (loaded, totalBytes) => onProgress({
			phase: "loading_recognition_model",
			loaded,
			totalBytes: totalBytes ?? void 0
		}) : void 0, useCache);
		if (this.options.warmup) {
			onProgress?.({ phase: "warmup" });
			await this.warmupSessions();
		}
	}
	async selectProvider() {
		const candidates = getProviderCandidates(this.options.providerPreference);
		const firstCandidate = candidates[0];
		if (!firstCandidate) throw new Error("No ONNX Runtime execution providers are available.");
		this.runtimeSelection = {
			provider: firstCandidate,
			candidates,
			benchmarked: false,
			benchmarks: []
		};
		return firstCandidate;
	}
	async warmup() {
		await this.init();
		await this.warmupSessions();
	}
	async warmupSessions() {
		if (!this.detectorSession || !this.recognizerSession) return;
		await runSession(this.detectorSession, createBlankTensor(640, 640), [
			1,
			3,
			640,
			640
		], this.options.manifest.detection.inputName, this.options.manifest.detection.outputName);
		const [channels, height, width] = this.options.manifest.recognitionImageShape ?? DEFAULT_RECOGNITION_SHAPE;
		await runSession(this.recognizerSession, new Float32Array(channels * height * width), [
			1,
			channels,
			height,
			width
		], this.options.manifest.recognition.inputName, this.options.manifest.recognition.outputName);
	}
	getRuntimeSelection() {
		return this.runtimeSelection;
	}
	async ocr(source, options = {}) {
		const onProgress = options.onProgress;
		await this.init(onProgress);
		if (!this.detectorSession || !this.recognizerSession || !this.runtimeSelection) throw new Error("The OCR runtime was not initialized.");
		onProgress?.({ phase: "preprocessing" });
		const image = await ensureImageData(source);
		const detectionInput = preprocessDetection(image, this.options.manifest.detectionLimitSideLen ?? 960);
		onProgress?.({ phase: "detecting" });
		const detectionOutput = await runSession(this.detectorSession, detectionInput.data, detectionInput.dims, this.options.manifest.detection.inputName, this.options.manifest.detection.outputName);
		const rawDetection = detectionOutput.data;
		const boxes = sortBoxes(postprocessDetection(rawDetection, detectionOutput.dims, {
			sourceWidth: image.width,
			sourceHeight: image.height,
			resizedWidth: detectionInput.resizedWidth,
			resizedHeight: detectionInput.resizedHeight,
			threshold: this.options.manifest.detectionThreshold ?? .3,
			boxThreshold: this.options.manifest.detectionBoxThreshold ?? .6,
			unclipRatio: this.options.manifest.detectionUnclipRatio ?? 1.5,
			minSize: this.options.manifest.detectionMinSize ?? 3
		}));
		const lines = await this.recognizeBoxes(image, boxes, options.maxRecognitionBatchSize ?? 8, onProgress);
		return {
			text: lines.map((line) => line.text).join("\n"),
			lines,
			image: {
				width: image.width,
				height: image.height
			},
			runtime: this.runtimeSelection
		};
	}
	async recognizeBoxes(image, boxes, batchSize, onProgress) {
		if (!this.recognizerSession) throw new Error("Recognizer session is not available.");
		const recognitionShape = this.options.manifest.recognitionImageShape ?? DEFAULT_RECOGNITION_SHAPE;
		const lines = [];
		const totalBatches = Math.ceil(boxes.length / batchSize);
		let batchIndex = 0;
		for (let cursor = 0; cursor < boxes.length; cursor += batchSize) {
			onProgress?.({
				phase: "recognizing",
				current: batchIndex + 1,
				total: totalBatches
			});
			const batchBoxes = boxes.slice(cursor, cursor + batchSize);
			const tensors = [];
			for (const box of batchBoxes) {
				const bounds = axisAlignedBounds(box);
				const crop = cropImageData(image, bounds.left, bounds.top, bounds.width, bounds.height);
				tensors.push(preprocessRecognition(crop, recognitionShape).data);
			}
			const merged = combineRecognitionBatch(tensors, recognitionShape);
			const [channels, height, width] = recognitionShape;
			const recognitionOutput = await runSession(this.recognizerSession, merged, [
				batchBoxes.length,
				channels,
				height,
				width
			], this.options.manifest.recognition.inputName, this.options.manifest.recognition.outputName);
			decodeRecognitionOutput(recognitionOutput.data, recognitionOutput.dims, this.dictionary).forEach((item, index) => {
				const box = batchBoxes[index];
				lines.push({
					text: item.text,
					score: (item.score + box.score) / 2,
					box
				});
			});
			batchIndex++;
		}
		return lines.filter((line) => line.text.length > 0);
	}
	dispose() {
		this.detectorSession = null;
		this.recognizerSession = null;
	}
};
function createPaddleOcr(options) {
	return new PaddleOcrWeb(options);
}
//#endregion
//#region src/manifests/official.ts
const DEFAULT_DICTIONARY_URL = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt";
const PPOCRV5_MODEL_PATHS = {
	detection: {
		server: "det_server.onnx",
		mobile: "det_mobile.onnx"
	},
	recognition: {
		server: "rec_server.onnx",
		mobile: "rec_mobile.onnx"
	}
};
function resolveDetectionPath(options) {
	if (options.detectionModelPath) return options.detectionModelPath;
	return PPOCRV5_MODEL_PATHS.detection[options.modelVariant ?? "mobile"];
}
function resolveRecognitionPath(options) {
	if (options.recognitionModelPath) return options.recognitionModelPath;
	return PPOCRV5_MODEL_PATHS.recognition[options.modelVariant ?? "mobile"];
}
function createPPOcrV5BrowserManifest(options) {
	const normalizedBase = options.baseUrl.replace(/\/$/, "");
	const variant = options.modelVariant ?? "mobile";
	return {
		id: variant === "server" ? "pp-ocrv5-browser" : `pp-ocrv5-${variant}-browser`,
		detection: { url: `${normalizedBase}/${resolveDetectionPath(options)}` },
		recognition: { url: `${normalizedBase}/${resolveRecognitionPath(options)}` },
		dictionary: { url: options.dictionaryUrl ?? "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/ppocrv5_dict.txt" },
		detectionLimitSideLen: 960,
		detectionThreshold: .3,
		detectionBoxThreshold: .6,
		detectionUnclipRatio: 1.5,
		detectionMinSize: 3,
		recognitionImageShape: [
			3,
			48,
			320
		]
	};
}
//#endregion
//#region src/presets/ppocrv5.ts
const DEFAULT_ORT_WASM_PATHS = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
const DEFAULT_MODEL_RELEASE_TAG = "models-ppocrv5-v4";
const DEFAULT_MODEL_BASE_URL = "https://zxc88645.github.io/ffocr/models/pp-ocrv5";
function createRecommendedOrtOptions(options) {
	return {
		wasmPaths: options?.wasmPaths ?? "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
		wasmThreads: options?.wasmThreads
	};
}
function createPPOcrV5(options) {
	const { baseUrl, dictionaryUrl, modelVariant, detectionModelPath, recognitionModelPath, ort, ...rest } = options;
	return createPaddleOcr({
		...rest,
		manifest: createPPOcrV5BrowserManifest({
			baseUrl,
			dictionaryUrl,
			modelVariant,
			detectionModelPath,
			recognitionModelPath
		}),
		ort: createRecommendedOrtOptions(ort)
	});
}
function createDefaultPPOcrV5(options = {}) {
	return createPPOcrV5({
		...options,
		baseUrl: DEFAULT_MODEL_BASE_URL
	});
}
async function ocrWithPPOcrV5(source, options, ocrOptions) {
	const runtime = createPPOcrV5(options);
	try {
		return await runtime.ocr(source, ocrOptions);
	} finally {
		runtime.dispose();
	}
}
async function ocrWithDefaultPPOcrV5(source, options = {}, ocrOptions) {
	return ocrWithPPOcrV5(source, {
		...options,
		baseUrl: DEFAULT_MODEL_BASE_URL
	}, ocrOptions);
}
//#endregion
export { DEFAULT_DICTIONARY_URL, DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_RELEASE_TAG, DEFAULT_ORT_WASM_PATHS, PPOCRV5_MODEL_PATHS, PaddleOcrWeb, createDefaultPPOcrV5, createPPOcrV5, createPPOcrV5BrowserManifest, createPaddleOcr, getAvailableExecutionProviders, getExecutionProviderSupport, getKnownExecutionProviders, isExecutionProviderAvailable, ocrWithDefaultPPOcrV5, ocrWithPPOcrV5, supportsWasm, supportsWebGl, supportsWebGpu, supportsWebNN };

//# sourceMappingURL=index.mjs.map