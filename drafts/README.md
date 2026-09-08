# drafts/

drop anything here — bullets, a voice-note transcript, a pasted chat with claude, half a paragraph.

on push, `.github/workflows/publish.yml` turns each file into a finished post in your voice
(`content/voice.md`), writes it to `posts/`, moves the draft to `drafts/published/`, and
rebuilds the index + rss. no build step; vercel redeploys on the push.

optional front matter at the top of a draft:

```
---
title: the title i want (else the ai picks)
type: build-log | take | sf-note | project-note
tags: agents, mcp
date: 2026-09-08
slug: custom-slug
---
```

files starting with `_` are ignored. locally: `ANTHROPIC_API_KEY=... node scripts/publish.mjs --dry`
