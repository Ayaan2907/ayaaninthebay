---
title: why my site is a terminal
date: 2026-09-08
summary: an agent that answers as me felt more honest than a hero image.
tags: site, agents, meta
type: take
---

most personal sites are a hero image, three adjectives, and a contact form. i didn't want to pick three adjectives.

i spend my day in a terminal talking to coding agents. the loop is: type a thing, watch it read a file, run a command, come back with an answer. that loop is the most honest picture of how i work. so the site is that loop, pointed at me.

## what it does

- `/work`, `/projects`, `/stack` run fake tool calls (`Read(about.md)`, `git log --author=ayaan`) and print the real content.
- anything else you type goes to a small serverless function that asks claude to answer as me, from a single `knowledge.js` file. it only knows what's in that file. if you ask about something i haven't written down, it says so and points you to x.
- `/map` flips the same data into a graph. that one's a nod to wingmic, which is a knowledge graph of the people you meet. same idea, one node wide.
- `/activity` pulls my github events live.

## what it isn't

no framework. no build step. static html, three js files, two serverless functions. it deploys anywhere that serves files and runs a node function.

blog posts are markdown in `posts/`. rough drafts go in `drafts/`, and a github action rewrites them in my voice (`content/voice.md`) before they ship. i'll write more about whether that actually sounds like me once it's been running a month.

if you got here from x: hi. type `coffee in sf?`.
