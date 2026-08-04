/**
 * 本地 OCR：扫描件/图片型 PDF 没有文本层，pdf-parse 提取不到内容。
 * 用 pdfjs-dist 把每页渲染成图片，交给 tesseract.js 识别文字。
 * 全程本地运行，不联网——语言包（chi_sim/eng traineddata）随应用打包分发，
 * 不用 tesseract.js 默认的远程 CDN langPath（那样会在识别时偷偷联网下载，违反"离线运行"的隐私承诺）。
 */
const path = require("path");
const { app } = require("electron");

// 语言包 fast 版本（准确率对检索场景够用，体积从几十 MB 降到几 MB），随应用打包在 resources/tessdata 下。
// 开发模式用项目根目录；打包后 electron-builder 的 extraResources 放到 process.resourcesPath。
function getTessdataPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "tessdata");
  return path.join(__dirname, "..", "..", "resources", "tessdata");
}

let workerPromise = null;

// worker 首次用到才创建（懒加载，模型/wasm 一起占几十 MB 内存，不该在应用启动时就常驻）。
// 不做空闲卸载：OCR 是低频操作（导入扫描件才用到），没有 aiWorkerClient 那种高频复用场景，
// 保持简单，进程退出时自然释放即可。
async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = require("tesseract.js");
    return Tesseract.createWorker(["chi_sim", "eng"], 1, {
      langPath: getTessdataPath(),
      cachePath: path.join(app.getPath("userData"), "tess-cache"),
      gzip: false,
    });
  })();
  return workerPromise;
}

// pdfjs-dist 默认 NodeCanvasFactory 是给 `canvas`(node-canvas) 包设计的，跟本项目用的
// @napi-rs/canvas（预编译 napi 二进制，无需系统 cairo/pango 依赖，Linux/Windows 打包更友好）
// API 不完全兼容——尤其 destroy 时 `canvas.width = 0` 的写法在 @napi-rs/canvas 上会抛异常。
// 自定义一个最简 CanvasFactory 桥接两者。
class NapiCanvasFactory {
  create(width, height) {
    const { createCanvas } = require("@napi-rs/canvas");
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function renderPageToBuffer(pdf, pageNum, canvasFactory) {
  const page = await pdf.getPage(pageNum);
  // scale 2.0：多数扫描件原始分辨率不高，放大渲染能明显提升 OCR 识别率，
  // 实测（内部测试图片）从默认 scale 1.0 的模糊断字到 2.0 后正确率显著改善
  const viewport = page.getViewport({ scale: 2.0 });
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: canvasAndContext.context, viewport, canvasFactory }).promise;
  return canvasAndContext.canvas.toBuffer("image/png");
}

/**
 * 对扫描件 PDF 做 OCR，逐页识别拼接全文。
 * @param {Buffer} pdfBuffer
 * @param {(info: {page: number, total: number}) => void} onPageProgress 每页开始识别前回调，用于同步进度提示
 * @returns {Promise<string>}
 */
async function ocrPdfBuffer(pdfBuffer, onPageProgress = () => {}) {
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const canvasFactory = new NapiCanvasFactory();
  const data = new Uint8Array(pdfBuffer);
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, canvasFactory }).promise;

  const worker = await getWorker();
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onPageProgress({ page: pageNum, total: pdf.numPages });
    const imgBuffer = await renderPageToBuffer(pdf, pageNum, canvasFactory);
    const { data: ocrResult } = await worker.recognize(imgBuffer);
    pageTexts.push(ocrResult.text);
  }
  return pageTexts.join("\n\n");
}

module.exports = { ocrPdfBuffer, getTessdataPath };
