// Per-ip sliding window, in memory. Good enough for one instance of a personal site.
// If this ever runs on more than one instance, move the buckets to redis and keep the interface.

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || "unknown";
}

// limiter({ perHour }) -> { take(ip) -> true if allowed, remaining(ip) }
function limiter({ perHour, windowMs = 3600e3, now = Date.now }) {
  const hits = new Map();
  const prune = (ip) => {
    const t = now();
    const kept = (hits.get(ip) || []).filter((x) => t - x < windowMs);
    if (kept.length) hits.set(ip, kept); else hits.delete(ip);
    return kept;
  };
  return {
    take(ip) {
      const kept = prune(ip);
      if (kept.length >= perHour) return false;
      kept.push(now()); hits.set(ip, kept);
      return true;
    },
    remaining(ip) { return Math.max(0, perHour - prune(ip).length); },
    size() { return hits.size; },
  };
}

// dailyCap(n) -> { take() -> true if under today's global cap }
function dailyCap(n, now = () => new Date()) {
  let day = "", count = 0;
  return {
    take() {
      const today = now().toISOString().slice(0, 10);
      if (today !== day) { day = today; count = 0; }
      if (count >= n) return false;
      count++; return true;
    },
    used() { return count; },
  };
}

module.exports = { clientIp, limiter, dailyCap };
