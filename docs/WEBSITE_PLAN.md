# Website plan: Interface Wars results site

Status: plan only. No site code is written yet. Review this plan before the build starts.

## Goal

A public site that shows what the experiment found and lets anyone check it, down to a single tool call. It serves
two readers:

- **Hackathon judges** who have a few minutes and need the result, the method and the Flagsmith usage at a glance.
- **Flagsmith engineers and curious developers** who want to open a transcript and see why an arm failed.

The demo video is made separately. The site must still look good in a screen recording, so key views must read
clearly at 1080p.

## Stack (same as On-Record `apps/web`)

| Piece | Choice | Notes |
|---|---|---|
| Framework | React 19 + React Router 7 | Client-side routes, as in On-Record |
| Build | Vite 8, TypeScript 6 (`tsc -b && vite build`) | Same scripts: `dev`, `build`, `lint`, `preview` |
| Styling | Plain CSS on design tokens | `src/styles/tokens.css` + `base.css`, one CSS file per page or component |
| Lint | oxlint with the On-Record `.oxlintrc.json` | `react/rules-of-hooks` as error |
| Fonts | `@fontsource-variable/*` packages | Self-hosted, no font CDN. Faces are chosen in the design step |
| Icons | `@phosphor-icons/react` | Same as On-Record |
| Theme | Light and dark, saved choice applied before first paint | Same pattern as On-Record `index.html` + `src/lib/theme.ts` |
| Data | Static JSON generated from `runs/`, no API | Like On-Record's demo fixtures, but this is the only data source |
| Hosting | Render static site | SPA rewrite of `/*` to `/index.html` |

Not taken from On-Record: the Python API, three.js, the force graph and audio code. The site has no backend.

## Folder layout

The repo already reserves `web/`. The site lives there with On-Record's internal layout. (Alternative: move it to
`apps/web/` and the harness to `apps/harness/`, which is a larger change for no user-visible gain.)

```
web/
  index.html                 meta, OG tags, theme script
  package.json               React, Vite, TypeScript, oxlint, fontsource, phosphor
  vite.config.ts
  tsconfig.json, tsconfig.app.json, tsconfig.node.json
  .oxlintrc.json
  README.md                  run, build, data refresh
  public/
    favicon.svg
    og.jpg                   1200x630 share image with the headline result
    data/                    generated, see "Data pipeline"
      readout.json
      trials.json            one slim row per trial
      trials/<trialId>.json  full transcript, loaded on demand
      skill.md               the frozen skill, shown on the method page
  src/
    main.tsx, App.tsx        router and app shell
    data/
      types.ts               Readout, TrialRow, Trial types (mirror src/trial.ts and readout.ts)
      load.ts                fetch helpers with caching
    lib/
      format.ts              percent, USD, token and duration formatting
      theme.ts               light/dark
      pageTitle.ts
    styles/
      tokens.css             colour, type, spacing, radius, motion tokens; arm colours
      base.css
    components/
      shell/                 AppShell, header, theme toggle, footer with repo link
      results/               ArmTable, VerdictCard, FlagsmithResult, IntervalBar, TemplateGrid
      trial/                 ToolCallTimeline, StateDiff, TrialHeader, CostTokens
      method/                PipelineDiagram, FindingsList
    pages/
      HomePage.tsx           /
      ResultsPage.tsx        /results
      JobPage.tsx            /jobs/:template
      TrialsPage.tsx         /trials
      TrialPage.tsx          /trials/:id
      MethodPage.tsx         /method
```

## Pages

### `/` Home

1. The question, with the kickoff quote: the Flagsmith team prefers the CLI and thinks it is "more performant".
2. The answer in one line, taken from the readout (for example "the CLI with the skill completed X% of jobs at Y the
   cost"), plus the shipped arm and who approved it.
3. The arm table: trials, jobs correct, out-of-scope changes, mean cost, cost per correct job, mean input tokens.
4. Flagsmith's Bayesian result for `job_correct` per arm: lift, 95% interval as a bar, chance to beat control.
5. How it works: the pipeline from flag assignment to `rollout_decision`, as one diagram.
6. What we found in Flagsmith: the MCP and API findings, each linking to a trial that shows it.
7. Links: repository, pre-registration, the skill.

### `/results` Full readout

- The decision for each arm under the pre-registered rule, with both analyses side by side (Flagsmith Bayesian and
  the template bootstrap) and the guardrails.
- The template grid: 16 rows by 3 arms, each cell `correct/n`, coloured by rate. Held-out rows are marked. Each row
  links to its job page.
- By family, held-out templates, sample-ratio check, spend, model and effort.

### `/jobs/:template` One job, three arms

The demo-video view. The same job template with one trial per arm in three columns:

- the task text (identical across arms),
- the tool calls in order, with inputs and clipped outputs; errors highlighted,
- the final DONE or FAILED line,
- the state diff the verifier saw, with allowed changes and collateral marked,
- turns, tokens, cost and time.

A picker chooses which trial each column shows. The default is the first trial per arm in that template.

### `/trials` Explorer

A table of all 255 counted trials, filterable by arm, template, family, correct and held out, and sortable by cost,
turns and time. Each row opens the trial page.

### `/trials/:id` One trial

The full transcript: every turn's text, tool calls, results, usage and cost, plus the state diff and the grading
reasons.

### `/method` Method

The pre-registration (hypotheses, arms, jobs, metrics, decision rule, exclusions, pilot, limits), the three arms'
setups, the frozen skill with its size in tokens, and the Flagsmith features used.

## Data pipeline

A Node script in the harness, `scripts/export-web-data.ts`, run after a readout:

```bash
node scripts/export-web-data.ts main        # writes web/public/data/
```

- Copies `runs/main/readout.json`.
- Writes `trials.json` with one slim row per trial (id, arm, template, family, held out, correct, collateral count,
  outcome, cost, turns, tool calls, tool errors, time).
- Writes `trials/<id>.json` with the transcript. Tool outputs are already clipped at 4000 characters in the trial
  record. Total size is checked; the target is under 15 MB.
- Removes anything that looks like a credential before writing, and fails if a pattern such as `sk-ant` or
  `Api-Key` is found. Sandbox keys are already destroyed with their organisations, but the site is public.
- Copies the frozen `skills/flagsmith-ops/SKILL.md`.

The generated `web/public/data/` is committed, so Render builds without access to `runs/`.

## Build, CI and hosting

- `web/package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `lint` (oxlint), `preview`.
- CI: add a `web` job to `.github/workflows/selftest.yml` that runs `npm ci`, `npm run lint` and `npm run build` in
  `web/`.
- Render static site via `render.yaml`: root `web`, build `npm ci && npm run build`, publish `dist`, rewrite `/*` to
  `/index.html`. The URL goes in the README and the submission.

## Design step (before code)

The visual direction is decided once, before page code, with the impeccable workflow:

1. Write `PRODUCT.md` (users, purpose, evidence on hand, constraints) from this plan.
2. Choose the visual world and record it in `DESIGN.md` and `web/src/styles/tokens.css`.
3. Fixed constraints: three arm colours that stay distinct for colour-blind viewers and in both themes; numbers in a
   tabular face; every chart readable at 1080p in a recording; no claim on the site that the readout does not
   support.

## Build order and time

| Step | Work | Estimate |
|---|---|---|
| 1 | Export script and generated data | 1 h |
| 2 | Scaffold `web/` (Vite, router, tokens, shell, theme), CI job | 1 h |
| 3 | Design step: PRODUCT.md, DESIGN.md, tokens | 1 h |
| 4 | Home and Results pages | 3 h |
| 5 | Job page (three columns) | 2 h |
| 6 | Trials explorer and trial page | 2 h |
| 7 | Method page, OG image, favicon | 1 h |
| 8 | Responsive and accessibility pass, Render deploy | 1 h |

About 12 hours. The deadline is 2026-11-29 14:30 UTC. Steps 1 to 5 are the minimum for the submission; steps 6 and
7 can be cut if time runs short.

## Open questions

1. Folder: `web/` (recommended) or `apps/web/` like On-Record?
2. Custom domain, like `onrecord.pallabdas.me`, or the default Render URL?
3. Should the site show the dry-run pipeline or the pilot at all? The plan shows only the counted main run, with
   the pilot summarised on the method page.
