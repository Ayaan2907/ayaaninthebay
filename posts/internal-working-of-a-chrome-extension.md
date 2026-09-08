---
title: internal working of a chrome extension
date: 2025-04-20
summary: what actually runs where when you install an extension. originally on substack.
tags: chrome, extensions, browser
type: take
draft: true
---

> this post originally ran on my substack — the full version is at [ayaankk.substack.com](https://ayaankk.substack.com). short version below.

an extension is three programs pretending to be one: a service worker with no dom, content scripts injected into someone else's page, and a popup that dies the moment you click away. most extension bugs are one of those three assuming it can see another one's memory.

i wrote this after building [text-completion-AI-extension](https://github.com/Ayaan2907/text-completion-AI-extension), and again after ARIA started life as a set of chrome extensions before we rebuilt it as one next.js app. the second time was the tell: once the "extension" needs auth, state, and streaming, it wants to be a web app.
