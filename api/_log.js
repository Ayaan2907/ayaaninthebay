// One logger. JSON lines on stdout so Railway's log search can filter by field.
// No console.* anywhere else in api/ or the server.
const { ENV } = require("./_env.js");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[ENV.logLevel];

function emit(level, event, fields) {
  if (LEVELS[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, event, ...(fields || {}) };
  if (line.err instanceof Error) line.err = { message: line.err.message, stack: ENV.nodeEnv === "production" ? undefined : line.err.stack };
  process.stdout.write(JSON.stringify(line) + "\n");
}

module.exports = {
  debug: (event, fields) => emit("debug", event, fields),
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
};
