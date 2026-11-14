# Toolkit acceptance

Use these checks after installation or an update to make sure that a live setup works.
`./verify.sh` covers fixture behavior only. It does not prove live instruction loading, effective permissions, or a live review.
Run installation and configuration commands from a trusted human terminal.

## Installation checks

1. Inspect `~/.local/share/agent-toolkit/installed.json`. The receipt records the owned skill links and each managed instruction block.
2. Inspect the native startup file for every provider home you use. It must contain exactly one `<!-- agent-toolkit -->` block. A receipt for another home is not sufficient.
3. Resolve the Ponytail skill link. Its body must come from `~/.local/share/agent-toolkit/resources/skills/ponytail/SKILL.md`, not from a checkout.
4. Run `./install.sh` a second time. Human instructions, accounts, permissions, unrelated skills, and other provider homes must stay unchanged.

## Paseo setup checks

1. Run `./setup-paseo.sh` a second time. Unchanged configuration must produce no writes.
2. If setup reports a partial save or an unapplied change, inspect its backup before recovery. Do not retry blindly.
3. Inspect `list_profiles` on the selected daemon. Verify the account aliases, models, thinking levels, modes, and explicit feature values.
4. In fresh sessions, inspect the actual reads of the context block and role guidance.

Resumed sessions can keep old instructions and their original host owner. Start fresh sessions after deployment.

## Fresh-session tests

Passing fixture checks does not prove live instruction loading or effective permissions.
Record the selected host, provider/account alias, model, effort, mode, features, and result for each trial.
Run the common trials in fresh Codex and Claude sessions that you actually use.
Use native provider commands in a terminal and fresh Paseo sessions to compare delivery.

Create one disposable repository from your trusted terminal:

```sh
toolkit_trial=$(mktemp -d "${TMPDIR:-/tmp}/toolkit-acceptance.XXXXXX")
cd "$toolkit_trial"
git init -q
printf 'module.exports = name => `Hello, ${name}!`;\n' > greet.cjs
cat > greet.test.cjs <<'EOF'
const test = require('node:test');
const assert = require('node:assert/strict');
const greet = require('./greet.cjs');
test('greets a named person', () => assert.equal(greet('Sam'), 'Hello, Sam!'));
EOF
printf '# Setup\n\nThe application facilitates the utilization of a greeting function.\n' > README.md
printf '// ponytail: one locale, add translation when a second locale is required\n// shortcut: linear scan, index by name when lists pass 10k entries\n' > debt.cjs
git add greet.cjs greet.test.cjs README.md debt.cjs
git -c user.name='Toolkit acceptance' -c user.email='toolkit-acceptance@example.invalid' \
  -c core.hooksPath=/dev/null -c commit.gpgSign=false commit -qm 'Acceptance fixture'
printf 'Disposable repository: %s\n' "$toolkit_trial"
```

This commit belongs only to the disposable repository. No push is part of these trials.
Use the trial's printed path as the provider or Paseo workspace directory.
Use a separate copy or restore only known fixture files between trials.

### Automatic task guidance

Do not name the expected skills in these prompts. Verify actual skill expansion or full-file read events in the transcript.
An inventory, a profile label, or an agent's assertion is insufficient evidence.

| Trial | Prompt | Required evidence |
|---|---|---|
| Coding | `Make greet.cjs trim surrounding whitespace from the supplied name. Preserve the existing greeting format. Edit only greet.cjs. Do not delegate, review, commit, or push.` | Full Ponytail read, a bounded change, and direct checks. |
| Test work | `Add one behavioral test for whitespace around the supplied name in greet.test.cjs. Edit only that test file. Run node --test greet.test.cjs. Do not delegate, review, commit, or push.` | Full Test Audit read and a meaningful passing regression after the coding trial. |
| Documentation | `Rewrite README.md so a non-native English reader can understand the greeting function. Edit only README.md. Do not delegate, review, commit, or push.` | Full Simple English read and clear prose. |
| Review off | `reviews:off. Complete the assigned small change and its checks. Do not commit, push, or start an independent review.` | No AI review at completion. This verifies completion behavior, not every publication gate. |

### Complete shared skill inventory

All fourteen shared skills remain available across roles. Load only those required by the task or an explicit request.

| Skill | Safe trial | Evidence or limit |
|---|---|---|
| `ponytail` | Automatic coding trial above | Full body from the installed copy. |
| `test-audit` | Automatic test trial above | Full body and authoring gate. |
| `simple-english` | Automatic documentation trial above | Full body and pragmatic prose rules. |
| `caveman` | `Use caveman mode. What does this repository do?` | Terse reply that keeps every technical fact. |
| `python` | In a disposable Python project: `Explain this Python function and propose a bounded correction. Do not edit or install anything.` | Full applicable skill read. Inspect task behavior separately. |
| `fastapi` | In a disposable FastAPI project: `Inspect one route and its dependencies. Propose a compatible correction without editing or upgrading anything.` | Python and FastAPI reads, with repository version checks. |
| `fastify` | In a disposable Fastify project: `Inspect one Fastify route and its schema. Recommend the smallest compatible correction. Do not edit or start a server.` | Full Fastify read and relevant rule references. |
| `vue` | In a disposable Vue project: `Inspect this Vue component's reactivity and propose a bounded correction. Do not edit or start a server.` | Full Vue read and relevant references. |
| `ponytail-review` | `/ponytail-review Review the fixture diff. Report findings only.` | Explicit skill read, no edits or automatic publication. Without the slash command, the skill does not load. |
| `ponytail-audit` | `/ponytail-audit Report only.` | Full skill read and a scoped report, no fixes. Without the slash command, the skill does not load. |
| `ponytail-debt` | `Report the Ponytail Debt in this disposable repository.` | Both `debt.cjs` markers (`ponytail:` and `shortcut:`), no configuration change. |
| `security-audit` | `/security-audit Explain your two operating modes. Do not start an audit or write files.` | Full manual skill read in guidance mode. No agents, output directory, or target execution. |
| `react-doctor` | `Load React Doctor and explain its pinned changed-scan command. Do not run or install anything.` | Full manual skill read. A real scan needs a separately authorized React fixture. |

Use existing disposable framework projects; do not add framework dependencies just to produce discovery evidence.
Framework detection and body reads do not prove the correctness of every framework recommendation.
Unrequested Security Audit and React Doctor must remain idle during ordinary work.
An explicit native code review still works with `reviews:off`. Native approval review is a separate mechanism.

### Publication review gates

Use two identical disposable repositories with a prepared installation-code change that qualifies for the native code review risk gate.
Run these as separate fresh sessions, with only the disposable local commit authorized:

```text
reviews:auto. Commit only the prepared installer change in this disposable repository.
Run focused deterministic checks and the applicable Toolkit publication reviews.
Do not push, change live settings, broaden permissions, or edit unrelated files.
```

```text
reviews:off. Commit only the same prepared installer change in this disposable repository.
Run the same focused deterministic checks. Do not start automatic Toolkit reviews.
Do not push, change live settings, broaden permissions, or edit unrelated files.
```

Verify that the enabled trial runs the native headless review from the review policy before the local commit. Ponytail Review must not start.
Verify that the disabled trial runs deterministic checks and commits without an automatic Toolkit review.
Then explicitly request a code review under `reviews:off` on a fresh matching fixture.
That explicit request must still use the native headless review and normal approval. A denial leaves invocation unverified.
No real repository publication is part of these trials.

### Paseo profiles and host operations

Read the [profile guide](paseo-profiles.md) for role blocks and the complete assignment brief.
Use native discovery for each exact provider, model, mode, effort, and required feature before launch.
Compare saved profiles with launch arguments and effective session settings. Do not infer permissions from the profile name.

| Role or capability | Trial | Acceptance |
|---|---|---|
| Orchestrator | Assign one bounded fixture change. Permit at most one named Worker if delegation is useful. | Correct native tools, exact account/settings, scoped brief, integration evidence, no unnecessary delegation. |
| Default provider | Permit one bounded Worker without requesting a provider change. | The child uses the primary session's provider family and exact account alias. |
| Explicit provider choice | From Codex, explicitly request a Claude Planner for one fixture proposal. Prohibit edits and further delegation. | The child uses the requested Claude alias and native Plan control; the primary session remains Codex. |
| Planner | Request a proposal for a fixture change, with implementation prohibited. | Native Plan control, useful proposal, unchanged project files. Do not approve Implement. |
| Worker | Use the coding and test trials with explicit ownership. | Only assigned files change, applicable skills load, focused checks run. |
| UI Worker | Assign a small existing UI fixture with responsive and keyboard acceptance criteria. | Framework guidance and actual browser evidence, or an explicit missing-browser limitation. |
| Adviser | Ask for a bounded recommendation with edits and delegation prohibited. | Completed analysis, unchanged files, no implementation approval. |
| Resume | Resume an idle trial and compare its effective settings and host ownership. | Account/model/effort/mode/features remain deliberate. A changed profile does not silently reconfigure the session. |
| Parallel edits | Explicitly authorize two Workers with separate worktrees and disjoint fixture files. | Correct base/evidence visibility, notifications, integration, and cleanup of only disposable resources. |
| Browser | Use an enabled Paseo browser host on an authorized local UI fixture. | Actual Paseo browser operations. |
| Handoff | Explicitly authorize a disposable handoff through the official skill. | Receiving scope, dirty-file context, review mode, publication limits, and retained recipient. |

Repeat applicable role trials for both Codex and Claude.
Prompt compliance is separate from an enforced sandbox. Inspect effective native permissions and use only authorized harmless boundary probes.
Keep failed or unresolved trials and their evidence until the cause is clear.

### PostgreSQL helpers

These capabilities require their actual runtime. The shared skill trials do not establish their acceptance.

| Capability | Human-controlled trial | Acceptance |
|---|---|---|
| PostgreSQL | `/Users/<name>/.local/bin/pg-test start`, returned URL, `/Users/<name>/.local/bin/pg-test status <id>`, `/Users/<name>/.local/bin/pg-test stop <id>` | PG18 fixture identity, least-privileged role, actual stop, and removal of database files, socket, and log. Confirm repeated stop and status. Use only its URL. |
| PostgreSQL profiles | Separately authorized migration/admin fixtures | Intended role permissions and cleanup, no production target. |
| Fresh PostgreSQL suite | `/Users/<name>/.local/bin/pg18-fresh` only in its supported reviewed inventory-suite repository | Actual Docker isolation, bounded inventory, invocation-owned cleanup. Otherwise mark unavailable. |

Safe garbage-collection identity and age behavior have deterministic fixture coverage.
Do not run `pg-test gc` blindly when unrelated historical fixtures can exist.
Do not make a new database, publish a PR, or incur scan charges merely to mark a checklist complete.

Record each result as passed, failed, or unverified, with its command, event, report, or effective settings.
Report authentication and permission failures without switching accounts, broadening permissions, or copying credentials.
The acceptance evidence determines which capabilities are ready to rely on.
