/**
 * 主进程侧的 AI worker 管理器。
 * 职责：
 *  - 懒加载 worker_thread（真正的模型加载在 worker.js 里，首次用到才会触发）
 *  - 任务排队串行执行，避免同时跑多个推理任务把 CPU 打满
 *  - 空闲 + 系统负载高 时自动卸载模型（terminate worker），释放内存；
 *    下次真正需要问答时再自动重新拉起，对用户尽量透明
 */
const { Worker } = require("worker_threads");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

// 唯一的卸载动机：机器被"别的进程"长时间占得很满，不给用户添堵。
// 单纯空闲（不管是我们软件闲着，还是整台机器都闲着）永远不构成卸载理由——
// 闲着的资源不用白不用，卸载了下次用户一问问题还得重新扛加载延迟，纯属自找麻烦。
const IDLE_UNLOAD_MS = 10 * 60 * 1000; // 空闲 10 分钟只是"有资格被考虑"，不是"该卸载"
const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次
const CPU_LOAD_THRESHOLD = 0.85; // 系统负载/核心数，要接近"跑满"这个量级才算数，平时的中等负载不该触发
const SUSTAINED_CHECKS_REQUIRED = 3; // 连续 3 次检查（约 3 分钟）都判定"忙"，才真正卸载——防止瞬时毛刺误杀

class AiWorkerClient {
  constructor(cacheDir, onStatusChange) {
    this.cacheDir = cacheDir;
    this.onStatusChange = onStatusChange || (() => {});
    this.worker = null;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.lastUsedAt = Date.now();
    this.loaded = false;
    this.consecutiveBusyChecks = 0;

    this.idleTimer = setInterval(() => this._maybeUnload(), CHECK_INTERVAL_MS);
  }

  _ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(path.join(__dirname, "worker.js"), {
      workerData: { cacheDir: this.cacheDir },
    });
    this.worker.on("message", (msg) => {
      if (msg.type === "progress") {
        this.onStatusChange({ phase: "loading-model", ...msg });
        return;
      }
      const resolver = this.pending.get(msg.id);
      if (!resolver) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") {
        resolver.reject(new Error(msg.error));
      } else {
        resolver.resolve(msg.result);
        // worker-started 只代表线程起来了，模型还没加载完；真正"就绪"要等第一个任务
        // 跑成功——这时候模型必然已经完整加载，才有资格告诉界面"可以用了"
        this.onStatusChange({ phase: "ready" });
      }
    });
    this.worker.on("error", (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.worker = null;
      this.loaded = false;
    });
    this.loaded = true;
    this.onStatusChange({ phase: "worker-started" });
    return this.worker;
  }

  _call(type, payload) {
    this.lastUsedAt = Date.now();
    const worker = this._ensureWorker();
    const id = randomUUID();
    const task = () =>
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload });
      });
    // 排队串行执行：同一时间只跑一个推理任务，避免 CPU 被打满
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  async embed(texts, isQuery = false) {
    if (!texts.length) return [];
    return this._call("embed", { texts, isQuery });
  }

  async rerank(query, candidates) {
    if (!candidates.length) return [];
    return this._call("rerank", { query, candidates });
  }

  async warmup() {
    return this._call("warmup", {});
  }

  _maybeUnload() {
    if (!this.worker) return; // 已经卸载了，不用管
    const idleFor = Date.now() - this.lastUsedAt;
    // 单纯空闲不是卸载的理由——用户可能就是开着软件没动，不代表要为难他。
    // 只有"空闲 + 别的进程确实在抢资源"才值得卸载，这是唯一的卸载动机。
    if (idleFor < IDLE_UNLOAD_MS) {
      this.consecutiveBusyChecks = 0;
      return;
    }

    const cpuCount = os.cpus().length || 1;
    // 用 5 分钟平均负载而不是 1 分钟的，本身就比瞬时值更抗毛刺；
    // 再要求连续多次检查都判定"忙"，双重过滤掉短暂的负载尖峰，避免误杀。
    // 之前这里还叠加了一个"剩余内存占比"判断，但 os.freemem() 在 macOS 上是个假信号——
    // macOS 会故意把大部分空闲内存挪去做磁盘缓存、不主动释放，freeRatio 常年个位数百分比，
    // 跟机器实际忙不忙没关系，结果是空闲一满 10 分钟这条内存判断必然为真，等于每次都会卸载，
    // 跟"CPU 不高就不该卸载"这个要求完全对不上。只保留 CPU 负载这一个真正有效的信号。
    const load5m = os.loadavg()[1] / cpuCount;
    const busy = load5m > CPU_LOAD_THRESHOLD;

    this.consecutiveBusyChecks = busy ? this.consecutiveBusyChecks + 1 : 0;
    if (this.consecutiveBusyChecks < SUSTAINED_CHECKS_REQUIRED) return;

    this.consecutiveBusyChecks = 0;
    this.worker.terminate();
    this.worker = null;
    this.loaded = false;
    this.onStatusChange({
      phase: "unloaded",
      reason: { idleFor, load5m },
    });
  }

  destroy() {
    clearInterval(this.idleTimer);
    if (this.worker) this.worker.terminate();
  }
}

module.exports = { AiWorkerClient };
