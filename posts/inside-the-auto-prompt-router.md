---
title: inside the auto prompt router
date: 2025-09-15
summary: a semantic classifier that routes each prompt to the llm that should answer it. originally on substack.
tags: llm, routing, npm
type: project-note
draft: true
---

> this post originally ran on my substack — the full version is at [ayaankk.substack.com](https://ayaankk.substack.com). short version below.

`auto-llm-selector` is an npm package that looks at a prompt and picks the model that should answer it, then sends it there through openrouter.

the classifier is tensorflow's universal sentence encoder. embed the prompt, compare against a small labelled set of prompt "shapes" (code, reasoning, chat, extraction, long-context), pick the model mapped to the winning shape. cached embeddings hit 85–92% of the time, so the average decision costs about 200ms.

it's typescript, esm-only, and sitting at 300+ weekly downloads, which is more than i expected for a weekend package.

the honest caveat: the mapping from shape → model is a config file, and the right answer changes every time a lab ships. the router is only as good as the day you last updated that file.
