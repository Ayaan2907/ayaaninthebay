/* bay: the scoring flow. rides on map.js (window.__bay: map, addEvents) and adds:
   - the events layer, fed from /api/events (the live store, already expired)
   - click-to-score on event dots: the card asks who you are (linkedin url, pasted lines,
     or the demo profile when the deployment runs the wingmic mock) and answers the
     owner's three questions: is this worth my time, what will come of it, should i go.
   - claim + link: a scored throwaway profile can be pushed into the owner's wingmic
     graph by linking a scoped dashboard key (/api/link does the capture), and the
     linked key also makes every later score read network overlap. wingmic v1 has no
     oauth to redirect through: the visitor pastes the key, this flow never pretends
     otherwise.
   loaded after map.js on /bay. */
(() => {
  "use strict";

  const bay = window.__bay;
  if (!bay || !bay.map) {
    console.error("bay: score flow needs map.js loaded first");
    return;
  }

  const EVENTS_URL = "/api/events?limit=200";
  const SCORE_URL = "/api/score";
  const LINK_URL = "/api/link";
  const TOKEN_KEY = "bay.wingmicToken"; // this session only; a throwaway credential

  const el = (cls) => {
    const n = document.createElement("div");
    n.className = cls;
    return n;
  };
  const fmtWhen = (startsAt) => {
    if (!startsAt) return "";
    const d = new Date(startsAt);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  // feature properties carry startsAt as a string; fmtWhen renders it human
  const fmtDate = (p) => (p && p.startsAt) || "";

  /* ---------- the events layer ---------- */

  function eventFeature(e) {
    return {
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
      // cat carries the store category: the persona weights read it (canon folds
      // it together with the places' singular vocabulary)
      properties: { id: e.id, name: e.title, note: e.venue || "", url: e.url || "", startsAt: e.startsAt || "", cat: e.category || "" },
    };
  }

  fetch(EVENTS_URL)
    .then((r) => {
      if (!r.ok) throw new Error("events fetch: " + r.status);
      return r.json();
    })
    .then((data) => {
      const withGeo = (data.events || []).filter((e) => Number.isFinite(e.lng) && Number.isFinite(e.lat));
      const feats = withGeo.map(eventFeature);
      bay.addEvents(feats, data.total != null ? data.total : feats.length);
      if (data.expired) console.info(`bay: ${data.expired} expired events not shown`);
      if (!feats.length && bay.hudNote) bay.hudNote("no live events right now — the places still carry their notes");
    })
    .catch((err) => {
      // never swallow it: the map still works, the event dots just do not show
      console.error("bay: events failed to load", err);
      if (bay.hudNote) bay.hudNote("events failed to load — the map still works");
    });

  /* ---------- the score card ---------- */

  let card = null;

  const close = () => {
    if (card) card.remove();
    card = null;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  const show = (root, sel) => {
    for (const part of root.querySelectorAll(".sc-pane")) part.hidden = true;
    const pane = root.querySelector(sel);
    if (pane) pane.hidden = false;
  };

  function buildCard(f) {
    close();
    const p = f.properties;
    const root = el("sc-card");
    root.innerHTML = `
      <button class="sc-x" aria-label="close">✕</button>
      <div class="sc-kicker">event</div>
      <h2 class="sc-title"></h2>
      <div class="sc-when"></div>

      <div class="sc-pane sc-ask">
        <p>tell me who you are and i will tell you if this is worth your evening.</p>
        <input class="sc-input" placeholder="linkedin url, or a few lines about you" spellcheck="false">
        <input class="sc-goal" placeholder="what do you want out of it? (optional)" spellcheck="false">
        <button class="sc-go">score it</button>
        <button class="sc-demo" hidden>use a demo profile instead</button>
        <button class="sc-signin-link" hidden>have wingmic? link your key</button>
        <div class="sc-note"></div>
      </div>

      <div class="sc-pane sc-loading" hidden>
        <span class="sc-spin"></span>reading the room…
      </div>

      <div class="sc-pane sc-result" hidden></div>

      <div class="sc-pane sc-signin" hidden>
        <p>paste a wingmic key from your wingmic dashboard and this map scores events against your real network. the key stays in this tab for the session.</p>
        <input class="sc-signin-key" type="password" placeholder="wk_live_…" spellcheck="false" autocomplete="off">
        <button class="sc-signin-go">link my network</button>
        <button class="sc-signin-back">back</button>
        <div class="sc-note"></div>
      </div>

      <div class="sc-pane sc-error" hidden></div>`;

    root.querySelector(".sc-title").textContent = p.name || "event";
    const when = [p.note, fmtWhen(fmtDate(p))].filter(Boolean).join(" · ");
    root.querySelector(".sc-when").textContent = when;
    root.querySelector(".sc-x").addEventListener("click", close);
    document.body.appendChild(root);
    card = root; // close() removes exactly this element — without the assignment, x and escape stack cards instead

    wireAsk(root, f);
    return root;
  }

  // capability probe, fetched once: drives the demo button, the sign-in entry and the
  // honest "demo network" label
  let wingmicLabel = null;
  const capsPromise = fetch(SCORE_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((caps) => {
      if (caps) wingmicLabel = caps.wingmic || null;
      return caps;
    })
    .catch(() => null);

  function wireAsk(root, f) {
    const input = root.querySelector(".sc-input");
    const goal = root.querySelector(".sc-goal");
    const go = root.querySelector(".sc-go");
    const demo = root.querySelector(".sc-demo");
    const signin = root.querySelector(".sc-signin-link");
    const note = root.querySelector(".sc-note");

    // capability probe: the demo path only on mock deployments; sign-in wherever a
    // wingmic client serves the deployment (mock included — its link flow works)
    capsPromise.then((caps) => {
      if (!caps) return;
      if (caps.wingmic === "mock") {
        demo.hidden = false;
        note.textContent = "this deployment runs a demo network — link a real key to score against your own.";
      }
      if (caps.wingmic) signin.hidden = false;
    });

    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      score(root, f, { wingmicToken: saved }, goal.value.trim(), "");
      return;
    }

    go.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) {
        note.textContent = "paste a linkedin url or a few lines about yourself first.";
        return;
      }
      // the server reads the shape (linkedin url vs pasted lines); the client sends it raw
      const isUrl = /^https:\/\/(www\.)?linkedin\.com\/(in|pub|company)\//i.test(text);
      const source = isUrl ? { kind: "linkedin_url", value: text } : { kind: "text", value: text };
      score(root, f, { source }, goal.value.trim(), text);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go.click();
    });
    demo.addEventListener("click", () => score(root, f, { wingmicToken: "mock-demo-1" }, goal.value.trim(), ""));
    signin.addEventListener("click", () => {
      root.querySelector(".sc-signin-key").value = "";
      root.querySelector(".sc-signin .sc-note").textContent = "";
      show(root, ".sc-signin");
      root.querySelector(".sc-signin-key").focus();
    });
    show(root, ".sc-ask");
  }

  function wireSignin(root, f) {
    const keyInput = root.querySelector(".sc-signin-key");
    const go = root.querySelector(".sc-signin-go");
    const back = root.querySelector(".sc-signin-back");
    const note = root.querySelector(".sc-signin .sc-note");

    back.addEventListener("click", () => show(root, ".sc-ask"));
    const submit = async () => {
      const key = keyInput.value.trim();
      const profile = root.querySelector(".sc-input").value.trim();
      if (!key) {
        note.textContent = "paste your wingmic key first.";
        return;
      }
      go.disabled = true;
      note.textContent = "linking…";
      try {
        const r = await fetch(LINK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, profile: profile || undefined }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          note.textContent = j.message || "that key did not work.";
          return;
        }
        sessionStorage.setItem(TOKEN_KEY, key);
        note.textContent = j.note || "linked — scoring with your network now.";
        score(root, f, { wingmicToken: key }, root.querySelector(".sc-goal").value.trim(), profile);
      } catch (e) {
        note.textContent = e instanceof TypeError ? "could not reach the scorer. check your connection." : "that did not work. try again.";
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener("click", submit);
    keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  // the claim surface, shown on a scored throwaway/pasted profile in the result pane
  function wireClaim(root, f, raw) {
    const box = root.querySelector(".sc-claim");
    if (!box) return;
    const keyInput = box.querySelector(".sc-claim-key");
    const go = box.querySelector(".sc-claim-go");
    const note = box.querySelector(".sc-claim-note");

    const submit = async () => {
      const key = keyInput.value.trim();
      if (!key) {
        note.textContent = "paste your wingmic key first — make one in the wingmic dashboard.";
        return;
      }
      go.disabled = true;
      note.textContent = "claiming…";
      try {
        const r = await fetch(LINK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, profile: raw || undefined }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          note.textContent = j.message || "that key did not work.";
          return;
        }
        sessionStorage.setItem(TOKEN_KEY, key);
        box.querySelector(".sc-claim-row").hidden = true;
        box.querySelector("p").hidden = true;
        box.querySelector(".sc-claim-link").hidden = true;
        box.querySelector("b").textContent = "profile claimed";
        go.hidden = true;
        note.classList.add("sc-ok");
        note.textContent = j.captured
          ? "this profile now lives in your wingmic graph — the rest of this map scores against your network."
          : j.note || "linked — the rest of this map scores against your network.";
      } catch (e) {
        note.textContent = e instanceof TypeError ? "could not reach the scorer. check your connection." : "that did not work. try again.";
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener("click", submit);
    keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  async function score(root, f, base, goal, raw) {
    show(root, ".sc-loading");
    let body;
    try {
      const r = await fetch(SCORE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, goal: goal || undefined, eventId: f.properties.id, persona: bay.personaId || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 400 && j.error === "profile_needed") {
        show(root, ".sc-ask");
        root.querySelector(".sc-note").textContent = j.message || "tell me a little about yourself first.";
        return;
      }
      if (r.status === 410) throw new Error("this event is over.");
      if (r.status === 404) throw new Error("that event is no longer listed.");
      if (r.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        throw new Error("that wingmic key did not work; link it again.");
      }
      if (!r.ok) throw new Error(j.message || `scoring failed (${r.status})`);
      body = j;
      if (body.profile && body.profile.kind === "wingmic" && base.wingmicToken) {
        sessionStorage.setItem(TOKEN_KEY, base.wingmicToken);
      }
    } catch (e) {
      if (e instanceof TypeError) {
        renderError(root, "could not reach the scorer. check your connection and try again.");
      } else {
        renderError(root, e.message || "scoring failed.");
      }
      return;
    }
    renderResult(root, body, raw);
  }

  const VERDICT = {
    go: { word: "go", cls: "sc-good" },
    maybe: { word: "borderline", cls: "sc-mid" },
    skip: { word: "skip it", cls: "sc-bad" },
  };

  function renderResult(root, body, raw) {
    const pane = root.querySelector(".sc-result");
    const s = body.score;
    const v = VERDICT[s.verdict] || VERDICT.maybe;
    const pct = Math.round((s.go || 0) * 100);
    const kind = body.profile && body.profile.kind;
    const claimable = (kind === "throwaway" || kind === "pasted") && !sessionStorage.getItem(TOKEN_KEY);

    const meetHtml = (s.meet || [])
      .map((m) => `<div class="sc-meetrow"><b></b> <span></span>${m.starter ? `<i class="sc-starter"></i>` : ""}</div>`)
      .join("");

    pane.innerHTML = `
      <div class="sc-verdict ${v.cls}"><b>${pct}%</b><span>${v.word}</span><em>${s.scorer === "llm" ? "scored with ai" : "typed score"}</em></div>
      <div class="sc-bar"><i style="width:${pct}%"></i></div>
      <div class="sc-outcome"></div>
      <ul class="sc-reasons">${(s.reasons || []).map(() => "<li></li>").join("")}</ul>
      <div class="sc-meet"><b>who to meet</b>${meetHtml || '<div class="sc-meetrow"><span>no read on the room yet.</span></div>'}</div>
      ${body.event && body.event.url ? `<a class="sc-link" target="_blank" rel="noopener">event page →</a>` : ""}
      ${
        claimable
          ? `<div class="sc-claim">
               <b>keep this profile</b>
               <p>link your wingmic key and this profile moves into your graph — then the map scores against your network.</p>
               <div class="sc-claim-row">
                 <input class="sc-claim-key" type="password" placeholder="paste a wingmic key (wk_live_…)" spellcheck="false" autocomplete="off">
                 <button class="sc-claim-go">claim & link</button>
               </div>
               <div class="sc-claim-note"></div>
               <a class="sc-claim-link" href="https://wingmic.xyz" target="_blank" rel="noopener">no key yet? make an account →</a>
             </div>`
          : ""
      }
      <div class="sc-meta"></div>`;

    // textContent for everything user-shaped; never interpolate server strings into html
    pane.querySelector(".sc-outcome").textContent = s.outcome || "";
    const lis = pane.querySelectorAll(".sc-reasons li");
    (s.reasons || []).forEach((r, i) => {
      if (lis[i]) lis[i].textContent = r;
    });
    pane.querySelectorAll(".sc-meetrow").forEach((row, i) => {
      const m = (s.meet || [])[i];
      if (!m) return;
      const b = row.querySelector("b");
      const sp = row.querySelector("span");
      const st = row.querySelector(".sc-starter");
      if (b) b.textContent = m.who;
      if (sp) sp.textContent = m.why || "";
      if (st && m.starter) st.textContent = `“${m.starter}”`;
    });
    const link = pane.querySelector(".sc-link");
    if (link && body.event.url) link.href = body.event.url;
    if (claimable) wireClaim(root, null, raw);

    const meta = pane.querySelector(".sc-meta");
    const bits = [];
    if (kind === "wingmic") bits.push("wingmic profile");
    if (kind === "throwaway") bits.push("throwaway profile, paste again any time");
    if (kind === "pasted") bits.push("from your paste");
    if (body.fit && body.fit.rank) bits.push(`#${body.fit.rank} of ${body.fit.of} live events for you`);
    if (wingmicLabel === "mock") bits.push("demo network (mock)"); // labeled only on mock deployments; real wiring drops it
    const view = window.BAY_PERSONAS && window.BAY_PERSONAS.resolvePersona(bay.personaId);
    if (view) bits.push(`view: ${view.label}`);
    meta.textContent = bits.join(" · ");

    if (kind === "wingmic") {
      const out = el("sc-signout");
      out.textContent = "unlink my key";
      out.addEventListener("click", () => {
        sessionStorage.removeItem(TOKEN_KEY);
        show(root, ".sc-ask");
      });
      meta.appendChild(out);
    }

    show(root, ".sc-result");
  }

  function renderError(root, message) {
    const pane = root.querySelector(".sc-error");
    pane.innerHTML = `<p></p><button class="sc-again">try again</button>`;
    pane.querySelector("p").textContent = message;
    pane.querySelector(".sc-again").addEventListener("click", () => show(root, ".sc-ask"));
    show(root, ".sc-error");
  }

  /* ---------- the hook the map calls ---------- */

  bay.onEventClick = (f) => {
    buildCard(f);
    wireSignin(document.body.querySelector(".sc-card"), f); // the sign-in pane lives in every card
  };
})();
