const zlib = require("zlib");

// 会话记录都是纯文本，落盘前 gzip 一下，减少长对话历史占用的磁盘空间
function compressText(text) {
  if (!text) return null;
  return zlib.gzipSync(Buffer.from(text, "utf-8"));
}

function decompressText(buffer) {
  if (!buffer) return "";
  try {
    return zlib.gunzipSync(buffer).toString("utf-8");
  } catch {
    // 兜底：万一遇到不是 gzip 格式的历史脏数据，别让一条坏记录拖垮整个会话的回显
    try {
      return Buffer.from(buffer).toString("utf-8");
    } catch {
      return "";
    }
  }
}

module.exports = { compressText, decompressText };
