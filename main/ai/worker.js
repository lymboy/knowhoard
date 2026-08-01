/**
 * 独立 worker_thread：本地 embedding + 本地 rerank。
 * 放到子线程里跑，是为了不卡住 Electron 主进程/界面，也方便后续做资源限制。
 */
const { parentPort, workerData } = require("worker_threads");
const path = require("path");

const { EMBEDDING_DIMENSIONS } = require("./dimensions");

const EMBEDDING_MODEL = "Xenova/bge-small-zh-v1.5"; // 中文优化、体积小，兼顾质量和本机算力
const RERANKER_MODEL = "Xenova/bge-reranker-base"; // 多语言（含中文），选 base 而非 large 以控制 CPU 占用

// 单批最多喂给模型多少段文本，批太大会把内存/CPU 一下打满
const EMBED_BATCH_SIZE = 8;

let embedPipelinePromise = null;
let rerankPipelinePromise = null;
let transformersModule = null;

async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import("@xenova/transformers");
    transformersModule.env.cacheDir = workerData.cacheDir;
    transformersModule.env.allowRemoteModels = true;
  }
  return transformersModule;
}

async function getEmbedPipeline() {
  if (!embedPipelinePromise) {
    embedPipelinePromise = (async () => {
      const { pipeline } = await getTransformers();
      return pipeline("feature-extraction", EMBEDDING_MODEL, {
        progress_callback: (data) => {
          if (data?.status === "progress") {
            parentPort.postMessage({
              type: "progress",
              model: "embedding",
              file: data.file,
              progress: data.progress,
            });
          }
        },
      });
    })();
  }
  return embedPipelinePromise;
}

async function getRerankPipeline() {
  if (!rerankPipelinePromise) {
    rerankPipelinePromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification } =
        await getTransformers();
      const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL);
      const model = await AutoModelForSequenceClassification.from_pretrained(
        RERANKER_MODEL,
        {
          progress_callback: (data) => {
            if (data?.status === "progress") {
              parentPort.postMessage({
                type: "progress",
                model: "reranker",
                file: data.file,
                progress: data.progress,
              });
            }
          },
        }
      );
      return { tokenizer, model };
    })();
  }
  return rerankPipelinePromise;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function embedTexts(texts, { isQuery = false } = {}) {
  const pipe = await getEmbedPipeline();
  const prefix = isQuery ? "query: " : "passage: "; // bge 系列的检索前缀，能明显提升召回
  const batches = chunkArray(texts, EMBED_BATCH_SIZE);
  const vectors = [];
  for (const batch of batches) {
    const input = batch.map((t) => `${prefix}${t}`);
    const output = await pipe(input, { pooling: "cls", normalize: true });
    const list = output.tolist();
    vectors.push(...list);
  }
  return vectors;
}

async function rerank(query, candidates) {
  // candidates: [{ id, text }]
  const { tokenizer, model } = await getRerankPipeline();
  const scores = [];
  for (const candidate of candidates) {
    const inputs = tokenizer(query, {
      text_pair: candidate.text,
      padding: true,
      truncation: true,
    });
    const { logits } = await model(inputs);
    scores.push({ id: candidate.id, score: logits.data[0] });
  }
  return scores;
}

parentPort.on("message", async (msg) => {
  const { id, type, payload } = msg;
  try {
    let result;
    if (type === "embed") {
      result = await embedTexts(payload.texts, { isQuery: payload.isQuery });
    } else if (type === "rerank") {
      result = await rerank(payload.query, payload.candidates);
    } else if (type === "warmup") {
      await getEmbedPipeline();
      await getRerankPipeline();
      result = { ready: true };
    } else {
      throw new Error(`未知任务类型: ${type}`);
    }
    parentPort.postMessage({ id, type: "result", result });
  } catch (error) {
    parentPort.postMessage({ id, type: "error", error: error.message });
  }
});

module.exports = { EMBEDDING_DIMENSIONS };
