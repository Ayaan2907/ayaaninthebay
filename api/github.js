// /api/github — live GitHub activity for the /activity command and the map.
// Public events (last ~90 days, no token needed) + optional full-year
// contribution calendar via GraphQL when GITHUB_TOKEN is set (read-only,
// any classic token with no scopes works). Cached at the edge for 15 min.

const { ENV } = require("./_env.js");
const log = require("./_log.js");
const USER = ENV.githubUser;

async function gh(url, token) {
  const r = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "ayaan-site", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`github ${r.status}`);
  return r.json();
}

function summarize(ev) {
  const repo = ev.repo && ev.repo.name ? ev.repo.name.replace(`${USER}/`, "") : "";
  const p = ev.payload || {};
  switch (ev.type) {
    case "PushEvent": {
      const n = (p.commits || []).length;
      const msg = p.commits && p.commits[0] ? p.commits[0].message.split("\n")[0] : "";
      return { verb: "push", repo, text: `${n} commit${n === 1 ? "" : "s"}${msg ? " — " + msg : ""}`, url: `https://github.com/${ev.repo.name}` };
    }
    case "PullRequestEvent":
      return { verb: `pr ${p.action}`, repo, text: p.pull_request ? p.pull_request.title : "", url: p.pull_request ? p.pull_request.html_url : "" };
    case "PullRequestReviewEvent":
      return { verb: "reviewed", repo, text: p.pull_request ? p.pull_request.title : "", url: p.pull_request ? p.pull_request.html_url : "" };
    case "IssuesEvent":
      return { verb: `issue ${p.action}`, repo, text: p.issue ? p.issue.title : "", url: p.issue ? p.issue.html_url : "" };
    case "IssueCommentEvent":
      return { verb: "commented", repo, text: p.issue ? p.issue.title : "", url: p.comment ? p.comment.html_url : "" };
    case "CreateEvent":
      return { verb: `created ${p.ref_type}`, repo, text: p.ref || "", url: `https://github.com/${ev.repo.name}` };
    case "WatchEvent":
      return { verb: "starred", repo: ev.repo.name, text: "", url: `https://github.com/${ev.repo.name}` };
    case "ForkEvent":
      return { verb: "forked", repo: ev.repo.name, text: "", url: p.forkee ? p.forkee.html_url : "" };
    case "ReleaseEvent":
      return { verb: "released", repo, text: p.release ? p.release.tag_name : "", url: p.release ? p.release.html_url : "" };
    default:
      return null;
  }
}

module.exports = async function handler(req, res) {
  const token = ENV.githubToken;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, s-maxage=900, stale-while-revalidate=3600");
  try {
    const pages = await Promise.all([1, 2, 3].map((p) => gh(`https://api.github.com/users/${USER}/events/public?per_page=100&page=${p}`, token).catch(() => [])));
    const events = pages.flat();
    const days = {};
    const feed = [];
    for (const ev of events) {
      const day = ev.created_at.slice(0, 10);
      const w = ev.type === "PushEvent" ? Math.max(1, ((ev.payload || {}).commits || []).length) : 1;
      days[day] = (days[day] || 0) + w;
      const s = summarize(ev);
      if (s && feed.length < 40) feed.push({ ...s, at: ev.created_at });
    }

    let calendar = null, total = null;
    if (token) {
      try {
        const q = `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
        const r = await fetch("https://api.github.com/graphql", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "ayaan-site" }, body: JSON.stringify({ query: q, variables: { u: USER } }) });
        const j = await r.json();
        const cal = j.data.user.contributionsCollection.contributionCalendar;
        total = cal.totalContributions;
        calendar = {};
        cal.weeks.forEach((w) => w.contributionDays.forEach((d) => { calendar[d.date] = d.contributionCount; }));
      } catch { /* fall back to events */ }
    }

    const user = await gh(`https://api.github.com/users/${USER}`, token).catch(() => null);
    const repos = await gh(`https://api.github.com/users/${USER}/repos?per_page=100&sort=pushed`, token).catch(() => []);
    const repoList = (Array.isArray(repos) ? repos : []).filter((r) => !r.fork).map((r) => ({
      name: r.name, desc: r.description || "", lang: r.language || "", stars: r.stargazers_count || 0, size: r.size || 0,
      pushed: r.pushed_at, created: r.created_at, url: r.html_url, home: r.homepage || "", topics: r.topics || [],
    }));
    res.end(JSON.stringify({
      user: USER,
      source: calendar ? "graphql" : "events",
      total,
      days: calendar || days,
      feed,
      repos: repoList,
      profile: user ? { repos: user.public_repos, followers: user.followers, following: user.following } : null,
      fetchedAt: new Date().toISOString(),
    }));
  } catch (e) {
    log.error("github", { err: e });
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};
