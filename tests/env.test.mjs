import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// _env.js validates at require time, so each case runs in a fresh process with its own env.
function load(env) {
  const out = execFileSync(process.execPath, ["-e", 'const { ENV } = require("./api/_env.js"); process.stdout.write(JSON.stringify(ENV))'], {
    env: { PATH: process.env.PATH, ...env }, cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

test("defaults with nothing set: chat off, visitor builds", () => {
  const e = load({});
  assert.equal(e.chatProvider, "none");
  assert.equal(e.buildMode, "visitor");
  assert.equal(e.port, 3000);
  assert.equal(e.ttsVoice, "Matthew");
});

test("a puter token flips chat and build to puter/owner", () => {
  const e = load({ PUTER_AUTH_TOKEN: "t" });
  assert.equal(e.chatProvider, "puter");
  assert.equal(e.buildMode, "owner");
});

test("BUILD_KILL=1 wins over everything", () => {
  assert.equal(load({ PUTER_AUTH_TOKEN: "t", BUILD_KILL: "1" }).buildMode, "off");
});

test("bad values fail at boot", () => {
  assert.throws(() => load({ BUILD_PER_HOUR: "lots" }), /BUILD_PER_HOUR/);
  assert.throws(() => load({ CHAT_PROVIDER: "openai" }), /CHAT_PROVIDER/);
  assert.throws(() => load({ BUILD_MODE: "owner" }), /needs PUTER_AUTH_TOKEN/);
});
