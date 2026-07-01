# The Loop Architect

A web app that transforms high-level engineering objectives into structured,
self-verifying agentic loops compatible with **Claude Code** and **Codex** —
the design interface for the "heartbeat," "body," and "spine" of autonomous
engineering workflows.

> "I don't prompt Claude anymore. I have loops running that prompt Claude…
> My job is to write loops."

## Running it

It's a fully static, dependency-free app — no build step.

```bash
cd loop-architect
python3 -m http.server 8080   # or any static file server
# open http://localhost:8080
```

It also deploys as-is on Vercel/Netlify/GitHub Pages (the repo's existing
Vercel static setup will serve `loop-architect/index.html` automatically).

## What it does — the six-step wizard

1. **Objective & Heartbeat** — Enter a vague objective; LLM-assisted scoping
   generates 3–5 *verifiable* success metrics (each flagged
   `verifiable`/`vague`). The Heartbeat Selection Matrix recommends one of
   four loop primitives: In-Session `/loop`, Run-Until-Done `/goal` (with a
   separate judge model), Scheduled (cron + GitHub Action YAML), or
   Event-Driven (webhooks).
2. **Infrastructure & Isolation** — Paste `git worktree list` output for
   state detection; generates worktree init commands and
   `isolation: worktree` flags for parallel sub-agents. Enables MCP
   connectors (GitHub, Linear, Playwright) with environment-variable
   mapping into `.claude/settings.json` or `.env` — key *references* only,
   never values.
3. **Knowledge & Skills** — SKILL.md generator with validation logic
   (required `intent` metadata + concrete tool-use instructions), a
   Reference Library that summarizes uploaded docs into the skill's
   metadata, and single-line "Tiny Prompts" (`/loop invoke $name`).
4. **Maker–Checker Agents** — Enforces adversarial review: the maker and
   checker must be different models (validated). Per-agent reasoning-effort
   toggle (low/medium/high/max), independent Playwright verification and
   security-review options, mandatory Decision Justification, and export as
   Markdown (`.claude/agents/`), TOML (`.codex/agents/`), or both.
5. **Spine & Guardrails** — `progress.md`/`AGENTS.md` schema with status
   tracking, Decision Log, and NEEDS-HUMAN escalation
   (max_iterations / max_spend / similarity_threshold / max_minutes /
   repeated-verification-failure), plus the Context Maintenance Routine
   appended to `CLAUDE.md`.
6. **Export** — Full manifest preview with per-file inspection, ZIP
   download, and the mandatory Human-in-the-Loop checklist (review diffs,
   resolve NEEDS-HUMAN notes, audit `/usage`/`/cost` shadow costs).

## LLM-assisted scoping

Works offline via a built-in heuristic engine. Optionally click
**LLM Scoping** and paste an Anthropic API key to have Claude (Haiku)
generate metrics and document summaries instead — the key lives only in
your browser's localStorage and is sent only to `api.anthropic.com`.

## Exported structure

```
project-root/
├── .claude/
│   ├── commands/goal.md        (heartbeat logic + guardrails)
│   ├── agents/implementer.md   (maker sub-agent)
│   ├── agents/reviewer.md      (adversarial checker sub-agent)
│   └── settings.json           (MCP mapping)
├── CLAUDE.md                   (rules + context-maintenance routine)
├── SKILL.md                    (validated skill + reference summaries)
├── progress.md                 (initial spine)
├── scripts/init-worktrees.sh   (isolation setup, when needed)
└── CHECKLIST.md                (human-in-the-loop audit)
```

Heartbeat-dependent extras: `cron/loop.crontab`,
`.github/workflows/loop-*.yml`, `.codex/agents/*.toml`, `.env.example`.
