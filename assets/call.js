/* /call: a voice call with the ai version of me, inside the terminal.
   v1, no infra: the browser's SpeechRecognition hears you, /api/chat answers as me (streamed),
   /api/tts (puter, free) speaks each sentence as it lands, you can talk over me to interrupt.
   works in chrome, edge, safari. firefox has no speech recognition: you type, i still talk.
   v2 (LiveKit Agents worker + deepgram + cloned voice) plugs into the same card; see README. */
(function () {
  const K = window.KNOWLEDGE;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let call = null; // { card, rec, history, t0, timer, muted, speaking, audio, queue, abort }

  function fmt(s) { s = Math.floor(s); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function cardHTML() {
    return `<div class="callcard">
      <div class="cc-top">
        <div class="cc-avatar"><span>a</span><i class="ring"></i></div>
        <div class="cc-meta"><div class="cc-name">ayaan <span class="dim">(ai)</span></div><div class="cc-status" data-status>connecting…</div></div>
        <div class="cc-time" data-time>00:00</div>
      </div>
      <div class="cc-live" data-live></div>
      <div class="cc-actions">
        <button data-mute title="mute">mute</button>
        <button data-end class="end" title="hang up">hang up</button>
      </div>
    </div>`;
  }
  function setStatus(s) { if (call) call.card.querySelector("[data-status]").textContent = s; }
  function setLive(s) { if (call) call.card.querySelector("[data-live]").textContent = s; }
  function speakingUI(on) { if (call) call.card.classList.toggle("speaking", on); }
  function listeningUI(on) { if (call) call.card.classList.toggle("listening", on); }

  async function start(ui) {
    if (call) { ui.error("already on a call. say bye or hit hang up."); return; }
    const t = ui.tool("Bash", "livekit-lite --room ayaan --voice matthew");
    const holder = ui.result(t, cardHTML());
    const card = holder.querySelector(".callcard");
    call = { card, rec: null, history: [], t0: Date.now(), timer: null, muted: false, speaking: false, audio: null, queue: [], abort: null, ui };
    call.timer = setInterval(() => { card.querySelector("[data-time]").textContent = fmt((Date.now() - call.t0) / 1000); }, 500);
    card.querySelector("[data-end]").onclick = () => end("hung up");
    card.querySelector("[data-mute]").onclick = (e) => { call.muted = !call.muted; e.target.textContent = call.muted ? "unmute" : "mute"; if (call.muted) stopListening(); else listen(); };

    // greet, then listen
    const hello = SR ? "hey, ayaan here. what's up?" : "hey, ayaan here. your browser can't hear you, so type and i'll talk back.";
    ui.agent(hello);
    call.history.push({ role: "assistant", content: hello });
    await speak(hello);
    if (SR) listen(); else setStatus("on a call · type below");
    if (SR) ui.agent("<span class=\"dim\">i'm listening. talk normally, interrupt me any time. say \"bye\" or hit hang up to end.</span>", true);
  }

  function listen() {
    if (!SR || !call || call.muted) return;
    try { if (call.rec) call.rec.abort(); } catch {}
    const rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
    let finalText = "";
    rec.onstart = () => { listeningUI(true); setStatus(call.speaking ? "on a call · talking" : "on a call · listening"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      if (interim) { setLive("you: " + interim); if (call.speaking) interrupt(); }
      if (finalText.trim()) { const q = finalText.trim(); finalText = ""; setLive(""); handleUser(q); }
    };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopListening(); if (call) { call.muted = true; call.card.querySelector("[data-mute]").textContent = "unmute"; setStatus("on a call · mic blocked, type instead"); call.ui.agent("<span class=\"dim\">the browser blocked the mic. allow it and hit unmute, or just type. i'll still talk.</span>", true); } } };
    rec.onend = () => { listeningUI(false); if (call && !call.muted) { try { rec.start(); } catch {} } };
    try { rec.start(); } catch {}
    call.rec = rec;
  }
  function stopListening() { if (call && call.rec) { const r = call.rec; call.rec = null; r.onend = null; try { r.stop(); } catch {} } listeningUI(false); }

  function interrupt() {
    if (!call) return;
    if (call.abort) { call.abort.abort(); call.abort = null; }
    call.queue = []; if (call.audio) { try { call.audio.pause(); } catch {} call.audio = null; }
    call.speaking = false; speakingUI(false);
  }

  async function handleUser(text) {
    if (!call) return;
    call.ui.user(text);
    if (/^(bye|goodbye|hang up|end call|that's all|thanks bye)\b/i.test(text)) { const out = "later. dm me on x if you want the real me."; call.ui.agent(out); await speak(out); end("ended"); return; }
    call.history.push({ role: "user", content: text });
    interrupt();
    const ac = new AbortController(); call.abort = ac;
    setStatus("on a call · thinking");
    let node = null, full = "", pending = "";
    const paint = () => { if (!node) node = call.ui.agent(""); node.querySelector(".c").innerHTML = MD.render(full); };
    const flush = (force) => {
      // speak complete sentences as they arrive
      const m = force ? [pending] : pending.match(/[^.!?\n]+[.!?\n]+/g);
      if (!m) return;
      for (const s of m) { const clean = s.replace(/[*_`#>]/g, "").trim(); if (clean) enqueue(clean); }
      pending = force ? "" : pending.slice(m.join("").length);
    };
    try {
      const r = await fetch("/api/chat", { method: "POST", signal: ac.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: call.history.slice(-12) }) });
      if (r.status === 503) { const out = "the ai side isn't wired up on this deployment, so it's just me typing. ask in the terminal instead."; call.ui.agent(out); await speak(out); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder();
      while (true) { const { value, done } = await reader.read(); if (done) break; const d = dec.decode(value, { stream: true }); full += d; pending += d; paint(); flush(false); }
      flush(true); call.history.push({ role: "assistant", content: full });
    } catch (e) { if (e.name !== "AbortError") call.ui.error("call dropped: " + e.message); }
  }

  // ---- tts queue: fetch audio per sentence, play in order, allow interruption
  function enqueue(text) { if (!call) return; call.queue.push(text); if (!call.speaking) pump(); }
  async function pump() {
    if (!call || !call.queue.length) { if (call) { call.speaking = false; speakingUI(false); setStatus(call.muted ? "on a call · muted" : "on a call · listening"); } return; }
    call.speaking = true; speakingUI(true); setStatus("on a call · talking");
    const text = call.queue.shift();
    await speak(text);
    if (call) pump();
  }
  async function speak(text) {
    if (!call) return;
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error("tts " + r.status);
      const url = URL.createObjectURL(await r.blob());
      await new Promise((res) => { const a = new Audio(url); call.audio = a; a.onended = a.onerror = () => { URL.revokeObjectURL(url); res(); }; a.play().catch(() => res()); });
    } catch {
      // fall back to the browser's voice
      await new Promise((res) => { try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.onend = u.onerror = () => res(); speechSynthesis.speak(u); } catch { res(); } });
    }
  }

  function end(why) {
    if (!call) return;
    interrupt(); stopListening(); clearInterval(call.timer);
    const dur = fmt((Date.now() - call.t0) / 1000);
    setStatus(`call ended · ${dur}`); call.card.classList.add("ended");
    const ui = call.ui; call = null;
    ui.agent(`<span class="dim">call ${why} after ${dur}. /call to ring again.</span>`, true);
  }

  window.CALL = { start, say: (t) => call && handleUser(t), active: () => !!call, end };
})();
