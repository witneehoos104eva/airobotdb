/* ============================================================
   The Loop Architect — application logic
   Transforms high-level objectives into structured,
   self-verifying agentic loops for Claude Code and Codex.
   ============================================================ */
"use strict";

/* ---------------- State ---------------- */
const DEFAULT_STATE = {
  step: 0,
  objective: "",
  loopName: "",
  repoPath: "",
  metrics: [],
  heartbeat: "run-until-done",
  heartbeatUserOverride: false,
  hbSchedule: "0 7 * * 1-5",
  hbScheduleTarget: "both", // cron | gha | both
  hbEvents: ["pr-opened"],
  judgeModel: "claude-haiku-4-5-20251001",
  unattended: false,
  // infra
  wtState: "none",
  wtBranch: "",
  parallelAgents: 2,
  connectors: { github: true, linear: false, playwright: false },
  envVars: { github: "GITHUB_TOKEN", linear: "LINEAR_API_KEY" },
  envTarget: "settings",
  // knowledge
  skillName: "",
  skillIntent: "",
  skillTools: "",
  references: [], // {name, summary}
  // agents
  makerModel: "claude-sonnet-5",
  makerEffort: "medium",
  makerNotes: "",
  checkerModel: "claude-opus-4-8",
  checkerEffort: "high",
  checkerPlaywright: false,
  checkerSecurity: true,
  decisionJustification: true,
  agentFormat: "claude",
  // spine & guardrails
  spineFile: "progress.md",
  maxIterations: 20,
  maxSpend: 25,
  similarityThreshold: 0.92,
  maxMinutes: 90,
  failRepeats: 3,
  contextMaintenance: true,
};

let S = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem("loop-architect-state");
    if (raw) return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
  } catch (e) { /* fresh start */ }
  return structuredClone(DEFAULT_STATE);
}
function saveState() {
  localStorage.setItem("loop-architect-state", JSON.stringify(S));
}

/* ---------------- Helpers ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 3200);
}

function kebab(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function loopName() {
  return S.loopName || kebab(S.objective) || "my-loop";
}
function skillName() {
  return S.skillName || loopName();
}

/* ============================================================
   LLM-ASSISTED SCOPING
   Uses the Anthropic API when a key is configured; otherwise a
   deterministic heuristic engine produces verifiable metrics.
   ============================================================ */
function getApiKey() { return localStorage.getItem("loop-architect-api-key") || ""; }

async function generateMetrics() {
  const objective = S.objective.trim();
  if (!objective) { toast("Enter an objective first.", true); return; }
  const btn = $("#btn-scope");
  btn.disabled = true; btn.textContent = "Scoping…";
  try {
    let metrics;
    if (getApiKey()) {
      metrics = await llmScope(objective);
    } else {
      metrics = heuristicScope(objective);
    }
    S.metrics = metrics.slice(0, 5);
    renderMetrics();
    saveState();
    toast(`Generated ${S.metrics.length} verifiable success metrics.`);
  } catch (e) {
    toast("LLM scoping failed (" + e.message + ") — using heuristic engine.", true);
    S.metrics = heuristicScope(objective);
    renderMetrics();
    saveState();
  } finally {
    btn.disabled = false; btn.textContent = "⚡ Generate Success Metrics";
  }
}

async function llmScope(objective) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getApiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `You are a Loop Engineering scoping assistant. A user gave this vague engineering objective:\n\n"${objective}"\n\nGenerate exactly 4 VERIFIABLE success metrics for an autonomous coding loop. Each metric must be checkable by a shell command or a binary condition (e.g. "Pass \`npm test\` with zero regressions", "Reduce cyclomatic complexity in /auth below 10"). Reply with ONLY a JSON array of 4 strings, nothing else.`,
      }],
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  const text = (data.content || []).map(c => c.text || "").join("");
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("unparseable response");
  const arr = JSON.parse(match[0]);
  if (!Array.isArray(arr) || !arr.length) throw new Error("empty response");
  return arr.map(String);
}

/* Deterministic heuristic scoping engine: detects the domain of the
   objective and instantiates verifiable metric templates. */
function heuristicScope(objective) {
  const o = objective.toLowerCase();
  const m = [];
  const area = (o.match(/\b(?:in|for|of|on)\s+([\w./-]+)/) || [])[1] || "the target module";

  if (/refactor|clean\s?up|complexity|tech(nical)? debt|simplif/.test(o)) {
    m.push(`Reduce cyclomatic complexity in ${area} below 10 (verify: \`npx complexity-report\` or \`radon cc\`)`);
    m.push("Pass the full test suite with zero regressions (verify: `npm test` exits 0)");
    m.push("No public API signatures change (verify: `git diff --stat` limited to internal files)");
    m.push("Lint passes with zero new warnings (verify: `npx eslint . --max-warnings 0`)");
  } else if (/test|coverage|spec/.test(o)) {
    m.push(`Line coverage for ${area} reaches ≥ 85% (verify: coverage report)`);
    m.push("All new tests pass in CI (verify: `npm test` exits 0)");
    m.push("No test relies on network or wall-clock time (verify: run offline with `--offline`)");
    m.push("Mutation score improves or holds (verify: `npx stryker run`)");
  } else if (/bug|fix|error|crash|issue/.test(o)) {
    m.push("A failing regression test reproducing the bug is added first, then made to pass");
    m.push("Full test suite passes with zero regressions (verify: `npm test` exits 0)");
    m.push("Root cause is documented in the Spine's Decision Log (not just the symptom)");
    m.push("No unrelated files modified (verify: `git diff --name-only` scoped to the fix)");
  } else if (/upgrade|dependenc|migrat|version|bump/.test(o)) {
    m.push("All dependencies upgrade cleanly (verify: `npm audit` reports 0 high/critical)");
    m.push("Build succeeds after upgrade (verify: `npm run build` exits 0)");
    m.push("Full test suite passes (verify: `npm test` exits 0)");
    m.push("Changelog of breaking changes written to the Spine for human review");
  } else if (/ci|pipeline|deploy|green|build/.test(o)) {
    m.push("CI pipeline is green on the target branch (verify: latest workflow run concluded `success`)");
    m.push("Each fix commit references the failing job it addresses");
    m.push("No force pushes and no skipped checks (verify: branch protection log)");
    m.push("Flaky tests are quarantined with a linked issue, not deleted");
  } else if (/doc|readme|comment/.test(o)) {
    m.push(`Every public function in ${area} has a doc comment (verify: lint rule or grep)`);
    m.push("README quick-start verified by running each command in a clean checkout");
    m.push("Docs build without warnings (verify: docs generator exits 0)");
    m.push("No stale references to removed APIs (verify: grep for old symbol names)");
  } else {
    m.push(`Objective "${objective.slice(0, 60)}" is decomposed into checkable tasks in the Spine`);
    m.push("Full test suite passes with zero regressions (verify: `npm test` exits 0)");
    m.push("Lint/typecheck passes (verify: `npx eslint .` and `npx tsc --noEmit` exit 0)");
    m.push("Every architectural decision has a rationale entry in the Decision Log");
  }
  return m;
}

/* Metric "verifiability" heuristic — does it name a command/condition? */
function metricVerifiable(text) {
  return /verify|`|exit|pass|fail|≥|<|>|==|report|coverage|complexity|\d/.test(text.toLowerCase());
}

/* ============================================================
   HEARTBEAT RECOMMENDATION
   ============================================================ */
function recommendHeartbeat(objective) {
  const o = objective.toLowerCase();
  if (/\b(daily|weekly|nightly|morning|every day|each day|routine|briefing|triage|audit)\b/.test(o)) return "scheduled";
  if (/\b(pr|pull request|issue|webhook|when .* opens|on push|react)\b/.test(o)) return "event-driven";
  if (/\b(watch|monitor|keep an eye|babysit|test run|deploy)\b/.test(o)) return "in-session";
  return "run-until-done";
}

const HB_LABELS = {
  "in-session": "In-Session (/loop)",
  "run-until-done": "Run-Until-Done (/goal)",
  "scheduled": "Scheduled (cron / Routines)",
  "event-driven": "Event-Driven (Channels / Webhooks)",
};

/* ============================================================
   WORKTREE DETECTION & COMMAND GENERATION
   ============================================================ */
function parseWorktreePaste(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const worktrees = lines
    .map(l => l.match(/^(\S+)\s+([0-9a-f]{6,40})\s+\[([^\]]+)\]/))
    .filter(Boolean)
    .map(m => ({ path: m[1], sha: m[2], branch: m[3] }));
  return worktrees;
}

function worktreeCommands() {
  const name = loopName();
  const branch = S.wtBranch || `agent/${name}`;
  const repo = S.repoPath || ".";
  const n = Number(S.parallelAgents) || 1;
  if (S.wtState === "no-isolation") {
    return { shell: null, note: "Running in the main checkout. Only one loop may run at a time — parallel threads would collide." };
  }
  if (S.wtState === "exists") {
    return { shell: null, note: "Clean worktree environment detected — no initialization needed. Sub-agents will use `isolation: worktree`." };
  }
  const cmds = [
    `# Initialize isolated worktree(s) for loop "${name}"`,
    `cd ${repo}`,
    `git fetch origin`,
    `git worktree add ../${name}-wt-1 -b ${branch}`,
  ];
  for (let i = 2; i <= n; i++) {
    cmds.push(`git worktree add ../${name}-wt-${i} -b ${branch}-t${i}`);
  }
  cmds.push(``, `# Verify:`, `git worktree list`);
  return { shell: cmds.join("\n"), note: null };
}

/* ============================================================
   REFERENCE LIBRARY — client-side summarization
   ============================================================ */
async function summarizeReference(name, text) {
  if (getApiKey()) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": getApiKey(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: `Summarize this internal document into 3-5 terse bullet points an autonomous coding agent needs to know. Reply with only the bullets.\n\nDOCUMENT (${name}):\n${text.slice(0, 12000)}`,
          }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const s = (data.content || []).map(c => c.text || "").join("").trim();
        if (s) return s;
      }
    } catch (e) { /* fall through to heuristic */ }
  }
  return heuristicSummarize(text);
}

function heuristicSummarize(text) {
  const lines = text.split("\n");
  const headings = lines.filter(l => /^#{1,3}\s+\S/.test(l)).slice(0, 5).map(l => l.replace(/^#+\s*/, ""));
  const firstPara = lines.filter(l => l.trim() && !/^#/.test(l)).slice(0, 2).join(" ").slice(0, 240);
  const bullets = [];
  if (firstPara) bullets.push(`- ${firstPara}${firstPara.length >= 240 ? "…" : ""}`);
  headings.forEach(h => bullets.push(`- Covers: ${h}`));
  if (!bullets.length) bullets.push("- (Document uploaded; no extractable structure — review manually.)");
  return bullets.join("\n");
}

/* ============================================================
   SKILL VALIDATION LOGIC
   ============================================================ */
function validateSkill() {
  const issues = [];
  if (!S.skillIntent.trim()) issues.push({ level: "err", msg: 'Missing required "intent" metadata — the agent cannot know when to invoke this skill.' });
  else if (S.skillIntent.trim().length < 20) issues.push({ level: "warn", msg: "Intent is very short — describe concretely when the skill applies." });
  if (!S.skillTools.trim()) issues.push({ level: "err", msg: "Missing tool-use instructions — the skill must name specific commands the agent runs." });
  else if (!/[`$]|npm|npx|git|pytest|make|cargo|go |sh |bash/.test(S.skillTools)) issues.push({ level: "warn", msg: "Tool-use instructions don't reference any concrete command — add executable steps." });
  if (issues.length === 0) issues.push({ level: "ok", msg: "SKILL.md is valid: intent metadata and tool-use instructions present." });
  return issues;
}

/* ============================================================
   GUARDRAIL & AGENT VALIDATION
   ============================================================ */
function validateAgents() {
  const issues = [];
  if (S.makerModel === S.checkerModel) {
    issues.push({ level: "err", msg: "Adversarial review violated: maker and checker use the same model. The model that writes the code must never be the one that grades it." });
  } else {
    issues.push({ level: "ok", msg: "Maker–checker split satisfied: distinct models for implementation and review." });
  }
  if (S.checkerEffort === "low") issues.push({ level: "warn", msg: "Reviewer effort is 'low' — security review is recommended at high effort." });
  return issues;
}

function validateGuardrails() {
  const issues = [];
  if (S.maxIterations > 100) issues.push({ level: "warn", msg: "max_iterations > 100 — quota exhaustion risk on unattended runs." });
  if (S.maxSpend <= 0) issues.push({ level: "warn", msg: "max_spend is 0 — the loop will terminate on the first billed turn." });
  if (S.similarityThreshold < 0.7) issues.push({ level: "warn", msg: "similarity_threshold below 0.7 will trigger false-positive drift escalations." });
  if (S.unattended && S.maxMinutes > 240) issues.push({ level: "warn", msg: "Unattended run capped above 4 hours — consider a tighter max_minutes." });
  if (!issues.length) issues.push({ level: "ok", msg: "Guardrails within recommended envelope." });
  return issues;
}

function escalationText() {
  return `IF iteration_count >= ${S.maxIterations} (max_iterations)
OR spend_usd >= ${Number(S.maxSpend).toFixed(2)} (max_spend)
OR elapsed_minutes >= ${S.maxMinutes} (max_minutes)
OR the same "Verification Failure" repeats ${S.failRepeats} times
OR Jaccard similarity of current tool calls vs the previous 3 turns >= ${S.similarityThreshold} with no metric progress
THEN:
  1. Write a bold **NEEDS-HUMAN** alert to the Spine (${S.spineFile})
     with the blocking reason and last known-good state.
  2. Terminate the loop. Do NOT retry past this point.`;
}

/* ============================================================
   FILE GENERATORS — the Export Manifest
   ============================================================ */
function metricsBlock() {
  return S.metrics.map((m, i) => `${i + 1}. ${m}`).join("\n") || "1. (no metrics defined)";
}

function genGoalCommand() {
  const name = loopName();
  const isGoal = S.heartbeat === "run-until-done";
  const cmd = isGoal ? "goal" : "loop";
  return `---
description: ${isGoal ? "Run-until-done heartbeat" : "In-session heartbeat"} for "${S.objective.trim() || name}"
${isGoal ? `judge-model: ${S.judgeModel}\n` : ""}max-iterations: ${S.maxIterations}
---

# /${cmd} — ${name}

## Objective
${S.objective.trim() || "(not specified)"}

## Verifiable Success Metrics
The loop is DONE only when every metric below verifies true.
${metricsBlock()}

## Loop Procedure (one iteration)
1. Read the Spine (\`${S.spineFile}\`). If a **NEEDS-HUMAN** flag is present, STOP immediately.
2. Pick the highest-priority incomplete task from the Spine.
3. Delegate implementation to the \`implementer\` sub-agent${S.wtState !== "no-isolation" ? " with `isolation: worktree`" : ""}.
4. Delegate verification to the \`reviewer\` sub-agent — it must run the checks itself; never trust the implementer's claim of success.
5. Update the Spine: mark completed items, flag failures, append Decision Log entries${S.decisionJustification ? " (rationale REQUIRED for every architectural choice)" : ""}.
6. Evaluate guardrails (below). If any trips, escalate and terminate.
${isGoal ? `7. Ask the judge model (${S.judgeModel}) to grade each success metric true/false against fresh evidence. All true → declare DONE and stop.` : `7. If all success metrics verify true → declare DONE and stop. Otherwise continue to the next iteration.`}

## Guardrails (deterministic — do not reinterpret)
| Parameter | Value | Function |
| --- | --- | --- |
| max_iterations | ${S.maxIterations} | Hard turn limit — prevents infinite cycles |
| max_spend | $${Number(S.maxSpend).toFixed(2)} | Hard dollar limit — controls financial liability |
| similarity_threshold | ${S.similarityThreshold} | Jaccard similarity check vs previous 3 turns — detects repetitive tool use |
| max_minutes | ${S.maxMinutes} | Temporal cap on ${S.unattended ? "background" : "in-session"} execution |

### Similarity guard
Before each tool call, compare the planned call (tool name + normalized arguments)
against the previous three turns. If similarity >= ${S.similarityThreshold} and no success
metric changed state since, treat it as Loop Drift: escalate instead of retrying.

### Escalation & termination
${escalationText().split("\n").map(l => "> " + l).join("\n")}
`;
}

function genScheduledCron() {
  const name = loopName();
  return `# Local cron — loop "${name}"
# Schedule: ${S.hbSchedule}
# Install with: crontab -e
${S.hbSchedule} cd ${S.repoPath || "$HOME/project"} && claude -p "/loop invoke \\$${name}" --max-turns ${S.maxIterations} >> .claude/loop-runs.log 2>&1
`;
}

function genScheduledGHA() {
  const name = loopName();
  return `name: loop-${name}
on:
  schedule:
    - cron: "${S.hbSchedule}"
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  run-loop:
    runs-on: ubuntu-latest
    timeout-minutes: ${S.maxMinutes}
    steps:
      - uses: actions/checkout@v4
      - name: Run agentic loop
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "/loop invoke $${name}"
          claude_args: "--max-turns ${S.maxIterations}"
`;
}

function genEventWorkflow() {
  const name = loopName();
  const events = S.hbEvents;
  const on = [];
  if (events.includes("pr-opened")) on.push("  pull_request:\n    types: [opened, synchronize]");
  if (events.includes("issue-opened")) on.push("  issues:\n    types: [opened]");
  if (events.includes("ci-failed")) on.push("  workflow_run:\n    workflows: [\"CI\"]\n    types: [completed]");
  return `name: loop-${name}-events
on:
${on.join("\n") || "  pull_request:\n    types: [opened]"}

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  react:
    runs-on: ubuntu-latest
    timeout-minutes: ${S.maxMinutes}
    steps:
      - uses: actions/checkout@v4
      - name: React via agentic loop
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "/loop invoke $${name} --event \${{ github.event_name }}"
          claude_args: "--max-turns ${S.maxIterations}"
`;
}

function genSettingsJson() {
  const mcp = {};
  if (S.connectors.github) {
    mcp.github = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "${" + (S.envVars.github || "GITHUB_TOKEN") + "}" },
    };
  }
  if (S.connectors.linear) {
    mcp.linear = {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-linear"],
      env: { LINEAR_API_KEY: "${" + (S.envVars.linear || "LINEAR_API_KEY") + "}" },
    };
  }
  if (S.connectors.playwright) {
    mcp.playwright = {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    };
  }
  const settings = {
    mcpServers: mcp,
    env: S.envTarget === "settings"
      ? Object.fromEntries(
          [
            S.connectors.github ? [S.envVars.github || "GITHUB_TOKEN", "<set in your shell or secret manager — never commit real values>"] : null,
            S.connectors.linear ? [S.envVars.linear || "LINEAR_API_KEY", "<set in your shell or secret manager — never commit real values>"] : null,
          ].filter(Boolean)
        )
      : {},
    permissions: {
      deny: ["Read(./.env)", "Read(./secrets/**)"],
    },
  };
  return JSON.stringify(settings, null, 2) + "\n";
}

function genDotEnvExample() {
  const lines = ["# Loop Architect — environment variables for MCP connectors", "# Copy to .env and fill in. NEVER commit .env."];
  if (S.connectors.github) lines.push(`${S.envVars.github || "GITHUB_TOKEN"}=`);
  if (S.connectors.linear) lines.push(`${S.envVars.linear || "LINEAR_API_KEY"}=`);
  lines.push("ANTHROPIC_API_KEY=");
  return lines.join("\n") + "\n";
}

function genClaudeMd() {
  const name = loopName();
  let out = `# CLAUDE.md — Loop "${name}"

## Objective
${S.objective.trim() || "(not specified)"}

## Rules
- The Spine (\`${S.spineFile}\`) is the single source of long-term truth. Read it at the start of EVERY run; update it before ending every run.
- Never mark a success metric complete without fresh verification evidence (command output, not memory).
- The implementer never grades its own work. Verification belongs to the \`reviewer\` sub-agent exclusively.
${S.decisionJustification ? `- **Decision Justification (mandatory):** every architectural choice gets a Decision Log entry in the Spine explaining WHY — the alternative considered and the reason it lost. Choices without rationale are treated as verification failures.` : ""}
${S.wtState !== "no-isolation" ? `- All implementation work happens in isolated git worktrees (branch \`${S.wtBranch || `agent/${name}`}\`). Never commit directly to the main checkout.` : ""}
- If a **NEEDS-HUMAN** flag exists in the Spine, stop immediately. Do not attempt to resolve it yourself.

## Success Metrics
${metricsBlock()}

## Tiny Prompts
Invoke this loop with single-line commands — do not paste instruction blocks:
- \`/loop invoke $${name}\` — run one heartbeat iteration
- \`/goal $${name}\` — run until all metrics verify true
`;
  if (S.contextMaintenance) {
    out += `
## Context Maintenance Routine
To manage token bloat while relying on the Spine for long-term memory:
1. After completing each Spine task, run \`/compact\` to fold resolved context.
2. If context exceeds ~70% of the window, write current state to the Spine, then \`/clear\` and re-read the Spine — it is designed to fully rehydrate the loop.
3. Never store long-term facts only in conversation memory; the Spine survives, the context window does not.
`;
  }
  return out;
}

function genSkillMd() {
  const name = skillName();
  const refBlock = S.references.length
    ? `\n## Reference Library (summarized)\n${S.references.map(r => `### ${r.name}\n${r.summary}`).join("\n\n")}\n`
    : "";
  return `---
name: ${name}
description: Project skill for loop "${loopName()}"
intent: |
  ${(S.skillIntent.trim() || "(TODO: describe when an agent should invoke this skill)").split("\n").join("\n  ")}
---

# SKILL: ${name}

## When to use
${S.skillIntent.trim() || "(TODO)"}

## Tool-use instructions
${S.skillTools.trim() || "(TODO: list the specific commands the agent must run)"}
${refBlock}
## Tiny prompt
\`/loop invoke $${name}\`
`;
}

function genSpine() {
  const name = loopName();
  return `# Spine — loop "${name}"
<!-- Persistent state file. The loop reads this first and writes it last, every run. -->

## Status
- **Loop:** ${name}
- **Heartbeat:** ${HB_LABELS[S.heartbeat]}
- **Mode:** ${S.unattended ? "Unattended (background autonomy)" : "In-session (active monitoring)"}
- **Iteration:** 0 / ${S.maxIterations}
- **Spend:** $0.00 / $${Number(S.maxSpend).toFixed(2)}

## Success Metrics
${S.metrics.map((m, i) => `- [ ] ${i + 1}. ${m}`).join("\n") || "- [ ] (define metrics)"}

## In Progress
_(none — loop not yet started)_

## Completed
_(none)_

## Failures Flagged
_(none)_

## Decision Log
<!-- ${S.decisionJustification ? "MANDATORY: every architectural choice needs a WHY entry here." : "Record notable decisions here."} -->
| When | Decision | Why (alternative considered) |
| --- | --- | --- |

## Escalation Protocol
${escalationText()}

<!-- When escalating, the loop writes below this line: -->
<!-- **NEEDS-HUMAN**: <reason> — <last known-good state> -->
`;
}

function agentBodyImplementer() {
  const name = loopName();
  return `You are the IMPLEMENTER (maker) for loop "${name}".

Objective: ${S.objective.trim() || "(see CLAUDE.md)"}

Rules:
- Implement the single task you were delegated — nothing more.
- Work only in your isolated worktree${S.wtState !== "no-isolation" ? "" : " (isolation disabled — be extra careful with shared state)"}.
- Run the project's own build/tests locally before reporting, but understand: your claim of success is NOT trusted. The reviewer verifies independently.
- Report: files changed, commands run, and ${S.decisionJustification ? "a Decision Log entry (decision + why + alternative considered) for any architectural choice" : "a summary of the change"}.
${S.makerNotes.trim() ? "- " + S.makerNotes.trim() : ""}`;
}

function agentBodyReviewer() {
  const name = loopName();
  return `You are the REVIEWER (checker) for loop "${name}" — an ADVERSARIAL evaluator.

You did not write this code. Your job is to find the reasons it should NOT merge.

Rules:
- NEVER trust the implementer's report. Re-run every verification yourself from a clean state.
- Verify each success metric with fresh command output:
${S.metrics.map((m, i) => `  ${i + 1}. ${m}`).join("\n") || "  (see CLAUDE.md)"}
${S.checkerPlaywright ? "- Run Playwright UI verification independently (via the playwright MCP connector) — screenshots or traces are the evidence, not assertions." : ""}
${S.checkerSecurity ? "- Perform a security-review pass at high effort: injection, authz gaps, secret leakage, unsafe deserialization." : ""}
- Verdict must be exactly PASS or FAIL with evidence. A FAIL must name the failing metric and the reproducing command.
- Two identical FAILs in a row → recommend escalation per the Spine protocol.`;
}

function genAgentMd(role) {
  const isMaker = role === "implementer";
  return `---
name: ${role}
description: ${isMaker ? "Implementation (maker) sub-agent" : "Adversarial review (checker) sub-agent"} for loop "${loopName()}"
model: ${isMaker ? S.makerModel : S.checkerModel}
effort: ${isMaker ? S.makerEffort : S.checkerEffort}
${S.wtState !== "no-isolation" && isMaker ? "isolation: worktree\n" : ""}tools: ${isMaker ? "Read, Edit, Write, Bash, Grep, Glob" : "Read, Bash, Grep, Glob" + (S.checkerPlaywright ? ", mcp__playwright" : "")}
---

${isMaker ? agentBodyImplementer() : agentBodyReviewer()}
`;
}

function tomlEscape(s) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function genAgentToml(role) {
  const isMaker = role === "implementer";
  const body = isMaker ? agentBodyImplementer() : agentBodyReviewer();
  return `# .codex/agents/${role}.toml — generated by The Loop Architect
name = "${role}"
description = "${isMaker ? "Implementation (maker) sub-agent" : "Adversarial review (checker) sub-agent"} for loop \\"${tomlEscape(loopName())}\\""
model = "${isMaker ? S.makerModel : S.checkerModel}"
effort = "${isMaker ? S.makerEffort : S.checkerEffort}"
${S.wtState !== "no-isolation" && isMaker ? 'isolation = "worktree"\n' : ""}
instructions = """
${body.replace(/"""/g, '\\"\\"\\"')}
"""
`;
}

function genWorktreeScript() {
  const wt = worktreeCommands();
  if (!wt.shell) return null;
  return `#!/usr/bin/env bash
set -euo pipefail
${wt.shell}
`;
}

function genChecklist() {
  return `# Human-in-the-Loop Checklist — loop "${loopName()}"

You designed the loop; you remain accountable for the output.
Complete this audit EVERY time the loop finishes or escalates.

- [ ] **1. Review the Diffs** — manually audit code changes before merging.
      \`git diff main...${S.wtBranch || `agent/${loopName()}`}\`
- [ ] **2. Verify "NEEDS-HUMAN" Notes** — open ${S.spineFile} and resolve any
      blockers the loop could not handle before restarting it.
- [ ] **3. Usage Auditing** — run \`/usage\` or \`/cost\` to monitor for
      Shadow Costs incurred by sub-agents (budget: $${Number(S.maxSpend).toFixed(2)} per run).

> "Designing the loop is the cure when you do it with judgment and the
> accelerant when you do it to avoid thinking."
`;
}

/* Build the complete export manifest: {path: content} */
function buildManifest() {
  const files = {};
  const name = loopName();
  const cmdFile = S.heartbeat === "run-until-done" ? "goal.md" : "loop.md";
  files[`.claude/commands/${cmdFile}`] = genGoalCommand();

  if (S.heartbeat === "scheduled") {
    if (S.hbScheduleTarget !== "gha") files["cron/loop.crontab"] = genScheduledCron();
    if (S.hbScheduleTarget !== "cron") files[`.github/workflows/loop-${name}.yml`] = genScheduledGHA();
  }
  if (S.heartbeat === "event-driven") {
    files[`.github/workflows/loop-${name}-events.yml`] = genEventWorkflow();
  }

  if (S.agentFormat === "claude" || S.agentFormat === "both") {
    files[".claude/agents/implementer.md"] = genAgentMd("implementer");
    files[".claude/agents/reviewer.md"] = genAgentMd("reviewer");
  }
  if (S.agentFormat === "codex" || S.agentFormat === "both") {
    files[".codex/agents/implementer.toml"] = genAgentToml("implementer");
    files[".codex/agents/reviewer.toml"] = genAgentToml("reviewer");
  }

  files[".claude/settings.json"] = genSettingsJson();
  if (S.envTarget === "dotenv") files[".env.example"] = genDotEnvExample();

  files["CLAUDE.md"] = genClaudeMd();
  files["SKILL.md"] = genSkillMd();
  files[S.spineFile] = genSpine();

  const wtScript = genWorktreeScript();
  if (wtScript) files["scripts/init-worktrees.sh"] = wtScript;

  files["CHECKLIST.md"] = genChecklist();
  return files;
}

/* ============================================================
   RENDERING
   ============================================================ */
function goStep(n) {
  S.step = Math.max(0, Math.min(5, n));
  $$(".panel").forEach(p => p.classList.toggle("hidden", Number(p.dataset.panel) !== S.step));
  $$(".step").forEach(st => {
    const i = Number(st.dataset.step);
    st.classList.toggle("active", i === S.step);
    st.classList.toggle("done", i < S.step);
  });
  if (S.step === 2) renderTinyPrompts();
  if (S.step === 3) renderValidation("#agent-validation", validateAgents());
  if (S.step === 4) { renderEscalation(); renderValidation("#guardrail-validation", validateGuardrails()); }
  if (S.step === 5) renderExport();
  saveState();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderValidation(sel, issues) {
  const el = $(sel);
  const icon = { ok: "✔", warn: "⚠", err: "✖" };
  el.innerHTML = issues.map(i => `<span class="v-${i.level}">${icon[i.level]} ${esc(i.msg)}</span>`).join("");
}

/* ----- Metrics ----- */
function renderMetrics() {
  const list = $("#metrics-list");
  list.innerHTML = "";
  S.metrics.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "metric-row";
    const ok = metricVerifiable(m);
    row.innerHTML = `
      <span class="metric-idx">${i + 1}</span>
      <input type="text" value="${esc(m)}" data-idx="${i}" />
      <span class="metric-verifiable ${ok ? "ok" : "warn"}">${ok ? "verifiable" : "vague"}</span>
      <button class="btn-del" data-idx="${i}" title="Remove">✕</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      S.metrics[Number(e.target.dataset.idx)] = e.target.value;
      const ok = metricVerifiable(e.target.value);
      const badge = e.target.nextElementSibling;
      badge.className = `metric-verifiable ${ok ? "ok" : "warn"}`;
      badge.textContent = ok ? "verifiable" : "vague";
      saveState(); renderMetricsValidation();
    });
  });
  list.querySelectorAll(".btn-del").forEach(b => {
    b.addEventListener("click", () => {
      S.metrics.splice(Number(b.dataset.idx), 1);
      renderMetrics(); saveState();
    });
  });
  renderMetricsValidation();
}

function metricsIssues() {
  const issues = [];
  const n = S.metrics.filter(m => m.trim()).length;
  if (n < 3) issues.push({ level: "err", msg: `Need 3–5 verifiable success metrics (currently ${n}).` });
  else if (n > 5) issues.push({ level: "warn", msg: `${n} metrics — the spec recommends 3–5; consider merging.` });
  else issues.push({ level: "ok", msg: `${n} success metrics defined.` });
  const vague = S.metrics.filter(m => m.trim() && !metricVerifiable(m)).length;
  if (vague) issues.push({ level: "warn", msg: `${vague} metric(s) look vague — each must be checkable by a command or condition.` });
  return issues;
}
function renderMetricsValidation() { renderValidation("#metrics-validation", metricsIssues()); }

/* ----- Heartbeat ----- */
function renderHeartbeat() {
  $$('#heartbeat-grid input[name=heartbeat]').forEach(r => { r.checked = r.value === S.heartbeat; });
  const rec = recommendHeartbeat(S.objective);
  $$(".hb-option").forEach(o => o.classList.toggle("recommended", o.dataset.hb === rec && S.objective.trim() !== ""));
  const recEl = $("#heartbeat-recommendation");
  if (S.objective.trim()) {
    recEl.classList.remove("hidden");
    recEl.innerHTML = `Recommended heartbeat for this objective: <strong>${HB_LABELS[rec]}</strong>${S.heartbeat !== rec && S.heartbeatUserOverride ? " — you overrode this; the loop will use " + HB_LABELS[S.heartbeat] + "." : ""}`;
  } else recEl.classList.add("hidden");
  renderHbConfig();
}

function renderHbConfig() {
  const el = $("#hb-config");
  if (S.heartbeat === "scheduled") {
    el.innerHTML = `
      <label class="field"><span class="field-label">Cron schedule</span>
        <input type="text" id="hb-schedule" class="mono" value="${esc(S.hbSchedule)}" /></label>
      <div class="radio-row"><span class="field-label">Export as:</span>
        <label class="check"><input type="radio" name="sched-target" value="cron" ${S.hbScheduleTarget === "cron" ? "checked" : ""}/> <span>Local cron</span></label>
        <label class="check"><input type="radio" name="sched-target" value="gha" ${S.hbScheduleTarget === "gha" ? "checked" : ""}/> <span>GitHub Action YAML</span></label>
        <label class="check"><input type="radio" name="sched-target" value="both" ${S.hbScheduleTarget === "both" ? "checked" : ""}/> <span>Both</span></label>
      </div>`;
    $("#hb-schedule").addEventListener("input", e => { S.hbSchedule = e.target.value; saveState(); });
    el.querySelectorAll('input[name=sched-target]').forEach(r =>
      r.addEventListener("change", e => { S.hbScheduleTarget = e.target.value; saveState(); }));
  } else if (S.heartbeat === "event-driven") {
    const evs = [["pr-opened", "PR opened / updated"], ["issue-opened", "Issue opened"], ["ci-failed", "CI run completed"]];
    el.innerHTML = `<div class="radio-row"><span class="field-label">Trigger events:</span>` +
      evs.map(([v, l]) => `<label class="check"><input type="checkbox" data-ev="${v}" ${S.hbEvents.includes(v) ? "checked" : ""}/> <span>${l}</span></label>`).join("") + `</div>`;
    el.querySelectorAll("input[data-ev]").forEach(c =>
      c.addEventListener("change", () => {
        S.hbEvents = [...el.querySelectorAll("input[data-ev]:checked")].map(x => x.dataset.ev);
        saveState();
      }));
  } else if (S.heartbeat === "run-until-done") {
    el.innerHTML = `
      <label class="field"><span class="field-label">Judge model <span class="hint">(separate model grades completion)</span></span>
        <select id="judge-model">
          <option value="claude-haiku-4-5-20251001" ${S.judgeModel.startsWith("claude-haiku") ? "selected" : ""}>claude-haiku-4-5 (fast judge)</option>
          <option value="claude-sonnet-5" ${S.judgeModel === "claude-sonnet-5" ? "selected" : ""}>claude-sonnet-5</option>
          <option value="claude-opus-4-8" ${S.judgeModel === "claude-opus-4-8" ? "selected" : ""}>claude-opus-4-8</option>
        </select></label>`;
    $("#judge-model").addEventListener("change", e => { S.judgeModel = e.target.value; saveState(); });
  } else {
    el.innerHTML = `<p class="hint">⚠ In-session loops stop when the terminal or session closes — use for active monitoring only.</p>`;
  }
}

/* ----- Worktrees ----- */
function renderWorktrees() {
  const wt = worktreeCommands();
  const el = $("#wt-commands");
  if (wt.shell) {
    el.innerHTML = `<div class="codeblock-label">Generated initialization commands (also exported as scripts/init-worktrees.sh):</div>` + codeblock(wt.shell);
  } else {
    el.innerHTML = `<p class="hint">${esc(wt.note)}</p>`;
  }
}

function codeblock(text) {
  const id = "cb" + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", () => { navigator.clipboard.writeText(text); toast("Copied."); });
  });
  return `<div class="codeblock">${esc(text)}<button class="cb-copy" id="${id}">Copy</button></div>`;
}

/* ----- Env mapping ----- */
function renderEnvMapping() {
  const el = $("#env-mapping");
  const rows = [];
  if (S.connectors.github) rows.push(["github", "GitHub token"]);
  if (S.connectors.linear) rows.push(["linear", "Linear API key"]);
  el.innerHTML = rows.length
    ? `<span class="field-label">Environment-variable names (references only — values stay in your shell/secret manager):</span>` +
      rows.map(([k, label]) => `
        <div class="env-row"><code>${label}</code>
          <input type="text" data-env="${k}" value="${esc(S.envVars[k] || "")}" spellcheck="false" /></div>`).join("")
    : `<p class="hint">No key-based connectors enabled.</p>`;
  el.querySelectorAll("input[data-env]").forEach(inp =>
    inp.addEventListener("input", e => { S.envVars[e.target.dataset.env] = e.target.value.trim(); saveState(); }));
}

/* ----- Skills ----- */
function renderSkillValidation() { renderValidation("#skill-validation", validateSkill()); }

function renderRefs() {
  const el = $("#ref-list");
  el.innerHTML = S.references.map((r, i) => `
    <div class="ref-item">
      <button class="ref-del" data-idx="${i}" title="Remove">✕</button>
      <div class="ref-name">${esc(r.name)}</div>
      <div class="ref-summary">${esc(r.summary)}</div>
    </div>`).join("");
  el.querySelectorAll(".ref-del").forEach(b =>
    b.addEventListener("click", () => { S.references.splice(Number(b.dataset.idx), 1); renderRefs(); saveState(); }));
}

function renderTinyPrompts() {
  const name = skillName();
  const lines = [
    `/loop invoke $${name}`,
    S.heartbeat === "run-until-done" ? `/goal $${loopName()}` : null,
    `/loop invoke $${name} --dry-run`,
  ].filter(Boolean).join("\n");
  $("#tiny-prompts").innerHTML =
    `<p class="hint">These single-line commands replace large instruction blocks — the skill carries the knowledge:</p>` + codeblock(lines);
}

/* ----- Escalation preview ----- */
function renderEscalation() { $("#escalation-preview").textContent = escalationText(); }

/* ----- Export ----- */
let currentPreviewPath = null;

function overallIssues() {
  return [
    ...metricsIssues().filter(i => i.level !== "ok"),
    ...validateSkill().filter(i => i.level === "err"),
    ...validateAgents().filter(i => i.level !== "ok"),
    ...validateGuardrails().filter(i => i.level !== "ok"),
  ];
}

function renderExport() {
  const issues = overallIssues();
  renderValidation("#export-validation",
    issues.length ? issues : [{ level: "ok", msg: "All validations pass — the loop is ready to deploy." }]);

  const files = buildManifest();
  const paths = Object.keys(files);
  if (!currentPreviewPath || !files[currentPreviewPath]) currentPreviewPath = paths[0];

  // Build a tree display
  const tree = $("#file-tree");
  tree.innerHTML = `<div class="ft-dir">project-root/</div>`;
  const dirsShown = new Set();
  paths.sort().forEach(p => {
    const parts = p.split("/");
    let prefix = "";
    for (let d = 0; d < parts.length - 1; d++) {
      prefix += parts[d] + "/";
      if (!dirsShown.has(prefix)) {
        dirsShown.add(prefix);
        const div = document.createElement("div");
        div.className = "ft-dir";
        div.textContent = "  ".repeat(d + 1) + parts[d] + "/";
        tree.appendChild(div);
      }
    }
    const item = document.createElement("div");
    item.className = "ft-item" + (p === currentPreviewPath ? " active" : "");
    item.textContent = "  ".repeat(parts.length) + parts[parts.length - 1];
    item.dataset.path = p;
    item.addEventListener("click", () => { currentPreviewPath = p; renderExport(); });
    tree.appendChild(item);
  });

  $("#preview-path").textContent = currentPreviewPath;
  $("#file-preview").textContent = files[currentPreviewPath];
}

async function downloadZip() {
  const files = buildManifest();
  if (typeof JSZip === "undefined") {
    toast("ZIP library unavailable (offline?) — use per-file download instead.", true);
    return;
  }
  const zip = new JSZip();
  Object.entries(files).forEach(([p, c]) => zip.file(p, c));
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${loopName()}-loop.zip`);
  toast("Export manifest downloaded. Unzip into your project root.");
}

function downloadCurrentFile() {
  const files = buildManifest();
  const p = currentPreviewPath;
  if (!p) return;
  triggerDownload(new Blob([files[p]], { type: "text/plain" }), p.split("/").pop());
}

function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ============================================================
   WIRING
   ============================================================ */
function bind(sel, prop, opts = {}) {
  const el = $(sel);
  if (!el) return;
  const evt = opts.event || "input";
  // initialize
  if (el.type === "checkbox") el.checked = !!S[prop];
  else el.value = S[prop] ?? "";
  el.addEventListener(evt, () => {
    S[prop] = el.type === "checkbox" ? el.checked
      : el.type === "number" ? Number(el.value)
      : el.value;
    saveState();
    if (opts.after) opts.after();
  });
}

function init() {
  /* Step nav */
  $$(".step").forEach(st => st.addEventListener("click", () => goStep(Number(st.dataset.step))));
  $$("[data-nav=next]").forEach(b => b.addEventListener("click", () => goStep(S.step + 1)));
  $$("[data-nav=prev]").forEach(b => b.addEventListener("click", () => goStep(S.step - 1)));

  /* Step 1 */
  bind("#objective", "objective", { after: () => { if (!S.heartbeatUserOverride) { S.heartbeat = recommendHeartbeat(S.objective); } renderHeartbeat(); } });
  bind("#loop-name", "loopName");
  bind("#repo-path", "repoPath");
  $("#loop-name").addEventListener("blur", () => { S.loopName = kebab(S.loopName); $("#loop-name").value = S.loopName; saveState(); });
  $("#btn-scope").addEventListener("click", generateMetrics);
  $("#btn-add-metric").addEventListener("click", () => { S.metrics.push(""); renderMetrics(); saveState(); });
  $$('#heartbeat-grid input[name=heartbeat]').forEach(r =>
    r.addEventListener("change", () => { S.heartbeat = r.value; S.heartbeatUserOverride = true; saveState(); renderHeartbeat(); }));
  bind("#unattended", "unattended", { event: "change" });
  $("#scope-mode-note").textContent = getApiKey()
    ? "Using Claude (Haiku) for scoping." : "No API key set — using built-in heuristic engine. Configure via “LLM Scoping”.";

  /* Step 2 */
  $("#worktree-paste").addEventListener("input", (e) => {
    const wts = parseWorktreePaste(e.target.value);
    const el = $("#worktree-detect");
    if (!e.target.value.trim()) { el.innerHTML = ""; return; }
    if (wts.length >= 2) {
      el.innerHTML = `<span class="v-ok">✔ Detected ${wts.length} worktrees (${wts.map(w => w.branch).join(", ")}) — clean worktree environment present.</span>`;
      S.wtState = "exists";
    } else if (wts.length === 1) {
      el.innerHTML = `<span class="v-warn">⚠ Single checkout on [${wts[0].branch}] — no isolation worktrees yet. Init commands generated below.</span>`;
      S.wtState = "none";
    } else {
      el.innerHTML = `<span class="v-err">✖ Could not parse — expected \`git worktree list\` format.</span>`;
    }
    $$('input[name=wt-state]').forEach(r => r.checked = r.value === S.wtState);
    saveState(); renderWorktrees();
  });
  $$('input[name=wt-state]').forEach(r => {
    r.checked = r.value === S.wtState;
    r.addEventListener("change", () => { S.wtState = r.value; saveState(); renderWorktrees(); });
  });
  bind("#wt-branch", "wtBranch", { after: renderWorktrees });
  bind("#parallel-agents", "parallelAgents", { event: "change", after: renderWorktrees });
  $$("#connector-grid input[data-conn]").forEach(c => {
    c.checked = !!S.connectors[c.dataset.conn];
    c.addEventListener("change", () => {
      S.connectors[c.dataset.conn] = c.checked;
      if (c.dataset.conn === "playwright") { $("#checker-playwright").checked = S.checkerPlaywright = S.checkerPlaywright && c.checked; }
      saveState(); renderEnvMapping();
    });
  });
  $$('input[name=env-target]').forEach(r => {
    r.checked = r.value === S.envTarget;
    r.addEventListener("change", () => { S.envTarget = r.value; saveState(); });
  });

  /* Step 3 */
  bind("#skill-name", "skillName");
  $("#skill-name").addEventListener("blur", () => { S.skillName = kebab(S.skillName); $("#skill-name").value = S.skillName; saveState(); });
  bind("#skill-intent", "skillIntent", { after: renderSkillValidation });
  bind("#skill-tools", "skillTools", { after: renderSkillValidation });
  $("#btn-ref-upload").addEventListener("click", () => $("#ref-upload").click());
  $("#ref-upload").addEventListener("change", async (e) => {
    for (const f of e.target.files) {
      if (f.size > 2 * 1024 * 1024) { toast(`${f.name}: over 2 MB — skipped.`, true); continue; }
      const text = await f.text();
      toast(`Summarizing ${f.name}…`);
      const summary = await summarizeReference(f.name, text);
      S.references.push({ name: f.name, summary });
      renderRefs(); saveState();
    }
    e.target.value = "";
  });

  /* Step 4 */
  bind("#maker-model", "makerModel", { event: "change", after: () => renderValidation("#agent-validation", validateAgents()) });
  bind("#checker-model", "checkerModel", { event: "change", after: () => renderValidation("#agent-validation", validateAgents()) });
  bind("#maker-notes", "makerNotes");
  bind("#checker-playwright", "checkerPlaywright", { event: "change" });
  bind("#checker-security", "checkerSecurity", { event: "change" });
  bind("#decision-justification", "decisionJustification", { event: "change" });
  $$(".effort-toggle").forEach(t => {
    const who = t.dataset.for; // maker | checker
    const prop = who + "Effort";
    t.querySelectorAll("button").forEach(b => {
      b.classList.toggle("active", b.dataset.effort === S[prop]);
      b.addEventListener("click", () => {
        S[prop] = b.dataset.effort;
        t.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
        saveState();
        renderValidation("#agent-validation", validateAgents());
      });
    });
  });
  $$('input[name=agent-format]').forEach(r => {
    r.checked = r.value === S.agentFormat;
    r.addEventListener("change", () => { S.agentFormat = r.value; saveState(); });
  });

  /* Step 5 */
  $$('input[name=spine-file]').forEach(r => {
    r.checked = r.value === S.spineFile;
    r.addEventListener("change", () => { S.spineFile = r.value; saveState(); renderEscalation(); });
  });
  bind("#g-max-iterations", "maxIterations", { after: () => { renderEscalation(); renderValidation("#guardrail-validation", validateGuardrails()); } });
  bind("#g-max-spend", "maxSpend", { after: () => { renderEscalation(); renderValidation("#guardrail-validation", validateGuardrails()); } });
  bind("#g-similarity", "similarityThreshold", { after: () => { renderEscalation(); renderValidation("#guardrail-validation", validateGuardrails()); } });
  bind("#g-max-minutes", "maxMinutes", { after: () => { renderEscalation(); renderValidation("#guardrail-validation", validateGuardrails()); } });
  bind("#g-fail-repeats", "failRepeats", { after: renderEscalation });
  bind("#context-maintenance", "contextMaintenance", { event: "change" });

  /* Step 6 */
  $("#btn-download-zip").addEventListener("click", downloadZip);
  $("#btn-download-file").addEventListener("click", downloadCurrentFile);
  $("#btn-copy-file").addEventListener("click", () => {
    const files = buildManifest();
    if (currentPreviewPath) { navigator.clipboard.writeText(files[currentPreviewPath]); toast("Copied " + currentPreviewPath); }
  });
  $$(".hitl").forEach(c => c.addEventListener("change", () => {
    const done = $$(".hitl").every ? null : null;
    const all = $$(".hitl").filter(x => x.checked).length === $$(".hitl").length;
    $("#hitl-note").innerHTML = all ? `<span class="v-ok">✔ Audit complete — you stayed the engineer.</span>` : "";
  }));

  /* API key modal */
  const modal = $("#api-modal");
  $("#btn-api-key").addEventListener("click", () => { $("#api-key-input").value = getApiKey(); modal.showModal(); });
  $("#api-cancel").addEventListener("click", () => modal.close());
  $("#api-clear").addEventListener("click", () => { localStorage.removeItem("loop-architect-api-key"); updateKeyDot(); modal.close(); toast("Key cleared."); });
  $("#api-save").addEventListener("click", () => {
    const k = $("#api-key-input").value.trim();
    if (k) localStorage.setItem("loop-architect-api-key", k);
    else localStorage.removeItem("loop-architect-api-key");
    updateKeyDot(); modal.close();
    toast(k ? "Key saved to this browser only." : "Key cleared.");
    $("#scope-mode-note").textContent = k ? "Using Claude (Haiku) for scoping." : "No API key set — using built-in heuristic engine.";
  });
  function updateKeyDot() {
    $("#api-key-status-dot").className = "dot " + (getApiKey() ? "dot-on" : "dot-off");
  }
  updateKeyDot();

  /* Reset */
  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("Reset all loop configuration? (Your API key is kept.)")) return;
    S = structuredClone(DEFAULT_STATE);
    saveState();
    location.reload();
  });

  /* Initial render */
  renderMetrics();
  renderHeartbeat();
  renderWorktrees();
  renderEnvMapping();
  renderSkillValidation();
  renderRefs();
  goStep(S.step);
}

document.addEventListener("DOMContentLoaded", init);
