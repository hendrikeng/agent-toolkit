---
name: deepsec
description: Run the pinned Vercel DeepSec vulnerability scanner manually for a read-only setup plan, workspace scaffold, free pattern scan, scoped AI review, or findings report. Invoke only with /skill:deepsec; hidden from automatic model invocation because AI scans can cost thousands of dollars and run agents with shell access.
disable-model-invocation: true
license: Apache-2.0
---

# DeepSec

DeepSec is manual-only. Never run it automatically during coding, review, commit, push, or task closeout. The wrapper lazily downloads the exact pinned `deepsec@2.3.5` package on first use, so normal toolkit installation stays small.

Treat DeepSec like a coding agent with full shell access. Run it only on trusted source code. Its AI stages can cost thousands or tens of thousands of dollars on large repositories.

The default wrapper path scaffolds a workspace configured for the locally logged-in Codex subscription, so no Vercel account or API key is required. DeepSec's upstream one-shot `init`/`setup` flow always links a Vercel project for Sandbox scope; use that path only when the user explicitly requests Vercel.

## Safe first steps

From the repository to inspect:

```bash
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" plan
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" scaffold
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" install
```

`plan` is a local, read-only explanation. `scaffold` creates `.deepsec/` and configures local Codex authentication; it does not install dependencies, authenticate, scan, invoke AI, or contact Vercel. `install` downloads the pinned workspace dependencies without running package lifecycle scripts.

## Local commands

After `scaffold` and `install`, complete `.deepsec/data/<project>/INFO.md` using its `SETUP.md`, then run local commands:

```bash
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" scan
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" status
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" report
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" export --format md-dir --out ./findings
```

`scan` is local pattern matching and does not invoke AI. Reports remain under `.deepsec/` unless an explicit output path is supplied.

## AI commands

Before any `init`, `process`, `revalidate`, or `triage` command:

1. Tell the user that DeepSec invokes an agent with shell access and may incur substantial model charges.
2. Show the exact command, scope, model, limits, and credential route.
3. Obtain explicit confirmation for that command.
4. Use the scaffolded local Codex route for ordinary `process` and `revalidate` runs.
5. For `triage`, disclose that `deepsec@2.3.5` uses Claude and obtain explicit approval for that credential route.
6. Set `DEEPSEC_ALLOW_AI=1` only for the confirmed invocation. Set `DEEPSEC_ALLOW_CLAUDE=1` for an approved `triage` invocation.
7. For `sandbox` or `sandbox-all`, disclose the source upload and Vercel costs. Set `DEEPSEC_ALLOW_VERCEL=1` only after approval.

The upstream one-shot initialization additionally requires explicit Vercel approval and both cost and duration caps:

```bash
DEEPSEC_ALLOW_AI=1 DEEPSEC_ALLOW_VERCEL=1 \
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" \
  init --max-cost-usd 25 --max-duration 30m --model-profile budget
```

For a focused working-tree review, bound the file count and concurrency:

```bash
DEEPSEC_ALLOW_AI=1 \
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/deepsec/scripts/deepsec" \
  process --diff-working --limit 10 --concurrency 1 --batch-size 1
```

DeepSec may return `1` when findings exist; inspect the generated findings before deciding whether the run failed. Treat findings as advisory, verify them in the real code, and keep fixes inside the user's requested scope.

After workspace installation, prefer the version-matched documentation at `.deepsec/node_modules/deepsec/SKILL.md` and `.deepsec/node_modules/deepsec/dist/docs/`.
