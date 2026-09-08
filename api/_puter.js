// Shared Puter client for the serverless functions. Uses the official SDK with MY token
// (owner mode). Free models on a free Puter account, as tested 2026-09-08: gpt-4.1, gpt-4.1-mini,
// gpt-4o, gpt-4o-mini, gpt-5-mini, gpt-5-nano, deepseek-chat. Claude models need credits.
// The OpenAI-compatible REST endpoint needs a paid subscription, so we don't use it.

const { ENV } = require("./_env.js");

let client = null;
function puter() {
  if (client) return client;
  const token = ENV.puterAuthToken;
  if (!token) throw new Error("PUTER_AUTH_TOKEN missing");
  const { init } = require("@heyputer/puter.js/src/init.cjs");
  client = init(token);
  return client;
}

// messages: [{role, content}] ; opts: { model, onChunk, timeout }
// returns the full text. streams through onChunk when given.
async function chat(messages, opts = {}) {
  const p = puter();
  const model = opts.model || ENV.chatModel;
  const timeout = opts.timeout || 90e3;
  const run = async () => {
    if (!opts.onChunk) {
      const r = await p.ai.chat(messages, { model });
      return typeof r === "string" ? r : (r && r.message && (typeof r.message.content === "string" ? r.message.content : (r.message.content || []).map((c) => c.text || "").join(""))) || "";
    }
    const s = await p.ai.chat(messages, { model, stream: true });
    let text = "";
    for await (const part of s) { const t = typeof part === "string" ? part : (part && (part.text || "")) || ""; if (t) { text += t; opts.onChunk(t); } }
    return text;
  };
  return Promise.race([run(), new Promise((_, rej) => setTimeout(() => rej(new Error("puter timeout")), timeout))]);
}

module.exports = { puter, chat };
