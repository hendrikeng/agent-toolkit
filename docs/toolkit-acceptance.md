# Toolkit acceptance

Use this checklist after an install or update to test a live setup.
`./verify.sh` covers fixture behavior only. It does not prove live instruction loading, effective permissions, or a live review.
Run install and setup commands from a trusted human terminal. Start fresh sessions. Resumed sessions keep old instructions.
For each trial, record the host, account alias, model, effort, mode, features, and result: passed, failed, or unverified.

## Install

- [ ] `~/.local/share/agent-toolkit/installed.json` lists the skill links and instruction blocks.
- [ ] Each provider home that you use has exactly one `<!-- agent-toolkit -->` block in its startup file.
- [ ] The Ponytail skill link resolves to `~/.local/share/agent-toolkit/resources/skills/ponytail/SKILL.md`.
- [ ] A second `./install.sh` leaves human instructions, accounts, permissions, and unrelated skills unchanged.

## Paseo setup

- [ ] A second `./setup-paseo.sh` with no changes writes nothing.
- [ ] `list_profiles` shows the expected aliases, models, effort, modes, and explicit feature values.
- [ ] If setup reports a partial save, inspect its backup before you try again.

## Fixture repository

```sh
d=$(mktemp -d "${TMPDIR:?}/toolkit-acceptance.XXXXXX") || exit 1
cd "$d" && git init -q
printf 'module.exports = name => `Hello, ${name}!`;\n' > greet.cjs
printf "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst greet = require('./greet.cjs');\ntest('greets', () => assert.equal(greet('Sam'), 'Hello, Sam!'));\n" > greet.test.cjs
printf '# Setup\n\nThe application facilitates the utilization of a greeting function.\n' > README.md
printf '// ponytail: one locale, add translation when a second locale is required\n// shortcut: linear scan, index by name when lists pass 10k entries\n' > debt.cjs
git add . && git -c user.name=acceptance -c user.email=acceptance@example.invalid -c core.hooksPath=/dev/null -c commit.gpgSign=false commit -qm fixture
echo "$d"
```

Use the printed path as the workspace. Do not push. Remove the directory with `rm -rf -- "${d:?}"` when you finish.

## Automatic skills

Do not name the skill in the prompt. Look for the full skill read in the transcript. A claim by the agent is not evidence.

- [ ] Coding: "Make greet.cjs trim whitespace around the name. Edit only greet.cjs. Do not commit." Ponytail loads.
- [ ] Tests: "Add one test for whitespace around the name in greet.test.cjs. Run node --test greet.test.cjs." Test Audit loads.
- [ ] Docs: "Rewrite README.md for a non-native English reader." Simple English loads.
- [ ] `reviews:off` with a small change: no AI review at completion.
- [ ] "Report the Ponytail Debt in this repository" does not load `ponytail-debt`. `/ponytail-debt` reports both `debt.cjs` markers.
- [ ] `/ponytail-review` and `/ponytail-audit` load only with the slash command.
- [ ] Security Audit and React Doctor stay idle unless requested.
- [ ] Framework skills (`python`, `fastapi`, `fastify`, `react`, `vue`) load in an existing project of that type. Do not add dependencies only for this check.

## Review gates

Use two copies of a fixture with a prepared installer change, and authorize a local commit only.

- [ ] `reviews:auto`: the native headless review from [code-review.md](code-review.md) runs before the commit. Ponytail Review does not start.
- [ ] `reviews:off`: the commit happens without an automatic review.
- [ ] An explicit review request under `reviews:off` still runs the native review.

## Paseo roles

Use the [profiles](paseo-profiles.md) and [role instructions](../shared/hosts/paseo-roles.md). Run the trials for both Codex and Claude.

- [ ] Orchestrator does a small task without unnecessary delegation.
- [ ] A worker uses the same provider family and account alias as its parent, unless the task asks for another.
- [ ] Planner uses native Plan, gives a useful proposal, and leaves files unchanged. Do not approve Implement.
- [ ] Worker changes only its assigned files and reports check results.
- [ ] UI Worker gives browser evidence or reports that it has no browser.
- [ ] Adviser gives a recommendation and leaves files unchanged.
- [ ] Two Workers in separate worktrees edit disjoint files. Notifications, integration, and cleanup work.
- [ ] A resumed session keeps its settings and host owner.
- [ ] Check effective permissions directly. Do not infer them from the profile name.

## PostgreSQL

- [ ] `pg-test start`, `status <id>`, and `stop <id>` (by full path) give a PG18 fixture with a least-privileged role. Stop removes the data files, socket, and log.
- [ ] Do not run `pg-test gc`.

Report authentication and permission failures. Do not switch accounts or broaden permissions to make a check pass.
