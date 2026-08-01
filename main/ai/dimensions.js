// bge-small-zh-v1.5 输出 512 维向量；抽成常量供 worker / 向量库 / 主进程共用，避免三处硬编码不同步
module.exports = { EMBEDDING_DIMENSIONS: 512 };
