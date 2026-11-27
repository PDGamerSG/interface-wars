# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, React Router 7, Vite 8, TypeScript 6, plain CSS on design tokens, oxlint, `@fontsource-variable/*` fonts,
`@phosphor-icons/react` icons. Chosen by the user to match their On-Record project (`apps/web`). The site lives in
`web/`, is static (JSON generated from `runs/`, no API) and is hosted as a Render static site on the default
Render URL.

## Users

- Hackathon judges for WeMakeDevs x Flagsmith "Toggle Wars". They have a few minutes per entry and score Use of
  Flagsmith, Impact, Creativity and the demo video.
- Flagsmith engineers and developers who run AI agents against Flagsmith. They want to check a claim down to a
  single tool call, and to see the MCP server findings in detail.
- Viewers of the demo video. The user records the video separately, so key views must read clearly in a 1080p
  screen recording.

## Product Purpose

Interface Wars is an experiment, run with Flagsmith Experimentation, that answers how an AI agent should operate
Flagsmith: through the official MCP server, through the Flagsmith CLI, or through the CLI plus an Agent Skill.
Real Claude agents do real Flagsmith jobs in sandbox organisations on self-hosted Flagsmith; a verifier compares selected
sandbox fields before and after each job. The site presents the result and every trial behind it. Success:
a judge understands the question, the answer and how Flagsmith ran the experiment within one screen, and anyone
can open any trial and see why it passed or failed.

## Positioning

It tests a claim the sponsor made on stage ("the CLI is more performant") with a pre-registered experiment that
Flagsmith itself assigns, measures, analyses and rolls out. Every number links to the transcripts and state diffs
that produced it.

## Operating Context

- Readers arrive from the hackathon submission page, the GitHub README or the demo video.
- They read on desktop most of the time; mobile must still work.
- Terms used throughout: arm (`mcp`, `cli`, `cli_skill`), trial, job template, job family (flags, targeting,
  experiments, repair), held-out template, collateral (an out-of-scope change), the verifier, the readout, the
  pre-registered decision rule, `rollout_decision`.

## Capabilities and Constraints

- Read-only static site. No accounts, no API, no live Flagsmith connection.
- Data comes from `runs/main/readout.json` and the trial records, exported to `web/public/data/` by a script.
- Every number on the site must come from the exported data. No claim the readout does not support.
- Public: the export must contain no credentials.

## Evidence on Hand

- 255-trial main run (`runs/main/`), with per-turn traces, clipped tool outputs, final state diffs, grading reasons, tokens and cost per trial.
- Readout with Flagsmith's Bayesian result and a template-level cluster bootstrap (`runs/main/readout.json`).
- Pre-registration (`prereg/PREREGISTRATION.md`, tag `prereg-v1`), pilot data (`runs/pilot/`, `runs/smoke-*`).
- The Agent Skill (`skills/flagsmith-ops/SKILL.md`).
- Findings about the Flagsmith MCP server and API, each traceable to trials or harness code (README).
- The kickoff-stream remark from the Flagsmith team that they prefer the CLI and think it is "more performant".
- Absent: testimonials, users, press, a logo. None may be invented.

## Product Principles

1. Every claim links to its evidence: a number opens the trials behind it.
2. Honest reading over a good story: inconclusive is a valid result and is shown as such.
3. The same job across three arms is the core view; it shows the difference instead of describing it.
4. Credit Flagsmith's own machinery: assignment, events, Bayesian results and the rollout decision are visible.

## Accessibility & Inclusion

WCAG 2.2 AA. The three arm colours must stay distinct for colour-blind readers and in both light and dark themes,
and never carry meaning alone (always paired with the arm name).
