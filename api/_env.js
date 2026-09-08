// Single place that reads process.env. Nothing else in api/ or scripts/ touches it.
// Validated once at first require; a bad value fails loudly at boot, not on the first request.
// Every var is documented in .env.example. Keep the two in sync.

const int = (name, fallback, { min = 0, max = 1e6 } = {}) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`env ${name}: expected an integer in [${min}, ${max}], got "${raw}"`);
  return n;
};
const oneOf = (name, allowed, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (!allowed.includes(raw)) throw new Error(`env ${name}: expected one of ${allowed.join("|")}, got "${raw}"`);
  return raw;
};
const str = (name, fallback = "") => {
  const raw = process.env[name];
  return raw == null || raw === "" ? fallback : String(raw).trim();
};

const PUTER_AUTH_TOKEN = str("PUTER_AUTH_TOKEN");
const ANTHROPIC_API_KEY = str("ANTHROPIC_API_KEY");

const chatProvider = oneOf("CHAT_PROVIDER", ["puter", "anthropic", "none"], PUTER_AUTH_TOKEN ? "puter" : ANTHROPIC_API_KEY ? "anthropic" : "none");
if (chatProvider === "puter" && !PUTER_AUTH_TOKEN) throw new Error("env CHAT_PROVIDER=puter needs PUTER_AUTH_TOKEN");
if (chatProvider === "anthropic" && !ANTHROPIC_API_KEY) throw new Error("env CHAT_PROVIDER=anthropic needs ANTHROPIC_API_KEY");

const buildMode = process.env.BUILD_KILL === "1"
  ? "off"
  : oneOf("BUILD_MODE", ["owner", "visitor", "off"], PUTER_AUTH_TOKEN ? "owner" : "visitor");
if (buildMode === "owner" && !PUTER_AUTH_TOKEN) throw new Error("env BUILD_MODE=owner needs PUTER_AUTH_TOKEN");

const ENV = Object.freeze({
  nodeEnv: oneOf("NODE_ENV", ["development", "production", "test"], "development"),
  port: int("PORT", 3000, { min: 1, max: 65535 }),
  siteUrl: str("SITE_URL", "https://ayaan.sh"),
  logLevel: oneOf("LOG_LEVEL", ["debug", "info", "warn", "error"], "info"),

  // chat: the ai version of me
  chatProvider,
  chatModel: str("CHAT_MODEL", "gpt-4.1"),
  chatPerHour: int("CHAT_PER_HOUR", 60, { min: 1 }),
  anthropicApiKey: ANTHROPIC_API_KEY,
  anthropicModel: str("ANTHROPIC_MODEL", "claude-sonnet-4-5"),

  // puter (chat, build, tts all ride on one token)
  puterAuthToken: PUTER_AUTH_TOKEN,

  // /build
  buildMode,
  buildModel: str("BUILD_MODEL", "gpt-4.1"),
  buildPerHour: int("BUILD_PER_HOUR", 3, { min: 1 }),
  buildDailyCap: int("BUILD_DAILY_CAP", 60, { min: 1 }),

  // /call
  ttsVoice: str("TTS_VOICE", "Matthew"),
  ttsPerHour: int("TTS_PER_HOUR", 240, { min: 1 }),

  // github
  githubUser: str("GITHUB_USER", "Ayaan2907"),
  githubToken: str("GITHUB_TOKEN"),
});

// Safe to print: secrets are reported as present/absent only.
function describe() {
  return {
    nodeEnv: ENV.nodeEnv, port: ENV.port, chatProvider: ENV.chatProvider, chatModel: ENV.chatModel,
    buildMode: ENV.buildMode, buildModel: ENV.buildModel, ttsVoice: ENV.ttsVoice,
    puter: ENV.puterAuthToken ? "set" : "missing", anthropic: ENV.anthropicApiKey ? "set" : "missing", github: ENV.githubToken ? "set" : "missing",
  };
}

module.exports = { ENV, describe };
