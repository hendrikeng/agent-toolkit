# Toolkit migration and acceptance

Run installation and configuration commands from a trusted human terminal on the machine that runs the providers.
Do not run them through an agent to repair that agent's permissions.
Preserve the current checkout, unrelated files, official host skills, accounts, credentials, and native permission choices.

## Back up and reconcile ownership

There is no blanket uninstall command. Complete removal must distinguish Toolkit resources from user configuration.
Deleting provider homes would also delete user configuration and authentication.

1. Finish active work and close provider sessions before deployment.
2. Identify the intended Paseo daemon and its provider homes in host settings.
3. Record `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, and `PASEO_HOME` overrides.
4. Back up those homes privately, including alternate account homes and historical Toolkit receipts.

For the selected default or overridden homes, use this private backup command:

```sh
bash <<'SH'
set -eu
umask 077
toolkit_backup=$(mktemp -d "$HOME/agent-toolkit-backup.XXXXXX")
printf 'Private backup directory: %s\n' "$toolkit_backup"
for toolkit_home in \
  "${CODEX_HOME:-$HOME/.codex}" \
  "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" \
  "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" \
  "${PASEO_HOME:-$HOME/.paseo}" \
  "$HOME/.codex-accounts" \
  "$HOME/.agents/skills" \
  "$HOME/.local/bin" \
  "$HOME/.local/share/agent-toolkit" \
  "$HOME/.local/libexec/agent-toolkit"
do
  if [ -d "$toolkit_home" ]; then
    toolkit_slot=$(mktemp -d "$toolkit_backup/home.XXXXXX")
    printf '%s\n' "$toolkit_home" > "$toolkit_slot/original-path.txt"
    printf 'Copying: %s\n' "$toolkit_home"
    if ! cp -Rp "$toolkit_home" "$toolkit_slot/snapshot"; then
      printf 'BACKUP INCOMPLETE: %s. Do not remove or install anything.\n' "$toolkit_home" >&2
      exit 1
    fi
    printf 'Copied: %s\n' "$toolkit_home"
  fi
done
printf 'Backup complete: %s\n' "$toolkit_backup"
SH
```

Paste the complete block, including the final `SH` line. A `>` continuation prompt means the shell is waiting for more input.
Copying a large provider home can take time. Wait for `Backup complete` and the normal terminal prompt before continuing.
If a copy fails, stop and complete that backup before installation.
These backups can contain credentials. Keep them private and out of repositories.
Back up additional account homes outside this list separately.
If an override selects another home, back up the default home separately before changing it.
For example, `CODEX_HOME` can select an Orca account while native Paseo still uses `~/.codex`.
The directory selected in Paseo's client does not select a local terminal's `PASEO_HOME`.

5. Compare old settings with ownership markers and historical backups.
6. Disable only the old Ponytail registrations that you deliberately replace with shared skills.
7. Reconcile only named, proven old Toolkit configuration entries.

For Claude, use the native plugin command with the intended `CLAUDE_CONFIG_DIR`:

```sh
claude plugin disable ponytail@ponytail --scope user
```

For each affected Codex home, change only the existing Ponytail plugin registration to disabled:

```toml
[plugins."ponytail@ponytail"]
enabled = false
```

Edit the existing registration, including inline or dotted forms. Do not add a duplicate table.
For an Orca account, use the exact `config.toml` path reported by preflight.
Do not change generic approval, sandbox, hook-trust, model, or account settings.

Pi can retain an old Ponytail package or explicit skill and extension paths.
Reconcile only entries named by the installer after comparing their ownership.
For an old Ponytail package that you retain, native package filters can disable its `skills` and `extensions` with empty arrays.
Preserve unrelated packages, permission extensions, and account stores.

## Completely remove the legacy Toolkit

Use this route for a clean replacement. Do not leave the old runtime or discovery links active.
Keep the private backup outside installation paths until the new installation passes acceptance.
Backups are recovery data, not an active legacy installation.

1. Remove proven old Toolkit package/plugin registrations through native management or a scoped configuration edit.
2. Remove proven old Toolkit explicit skill paths, provider prompt/rule references, and retired Pi status integration entries.
3. Preserve generic native permissions unless historical evidence proves a specific setting belongs to the retired Toolkit design.
4. Inspect all provider homes, including the exact Orca account home previously named by preflight.

Disabling a Ponytail plugin stops its hooks but leaves its package installed.
For complete removal, uninstall only the old plugin that you deliberately replace, using that provider's supported plugin management.
Do not delete a provider's complete plugin cache. It can contain unrelated plugins.

The following trusted-terminal snippet removes individually classified legacy symlinks and files with matching SHA-256 ownership markers.
It does not remove configuration entries, unmarked files, provider homes, or the old snapshot directory.
It checks every candidate before removing any. A modified resource stops removal for manual reconciliation.
Set the intended provider-home overrides first. Add external account homes to the directory list before running it.
Compare each offered symlink with historical installation evidence before classifying it as owned.
Its destination alone does not establish ownership. An unknown or unrelated link stops this procedure before deletion.

```sh
python3 - <<'PY'
import hashlib
import os
import sys
from pathlib import Path

home = Path.home()
if not sys.stdout.isatty():
    raise SystemExit('Use a trusted human terminal, not an agent or a pipe.')
legacy = home / '.local/libexec/agent-toolkit'
codex = Path(os.environ.get('CODEX_HOME', str(home / '.codex')))
claude = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(home / '.claude')))
pi = Path(os.environ.get('PI_CODING_AGENT_DIR', str(home / '.pi/agent')))
accounts = [codex]
registry = home / '.codex-accounts'
if registry.is_dir():
    accounts += [p for p in registry.iterdir() if p.is_dir() and not p.is_symlink()]
folders = [home / '.agents/skills', claude / 'skills', pi / 'skills',
           pi / 'extensions', pi / 'integrations', home / '.local/bin']
folders += [p / 'skills' for p in accounts]
files = [claude / 'CLAUDE.md', pi / 'AGENTS.md'] + [p / 'AGENTS.md' for p in accounts]
files += [home / '.local/bin' / n for n in
          ['codex-yolo', 'claude-yolo', 'pi-yolo', 'autoreview-yolo',
           'pg18-fresh-yolo', 'repo-delete', 'pg-test', 'pg18-fresh']]
files += [p / 'rules' / n for p in accounts for n in
          ['agent-safety.rules', 'agent-toolkit-development.rules']]
files += [pi / 'extensions' / 'workspace-sandbox' / 'index.ts',
          pi / 'extensions' / 'python-inline-guard' / 'index.ts',
          pi / 'extensions' / 'pi-permission-system' / 'config.json']
for directory in [legacy, codex, claude, pi, registry] + folders + accounts:
    for ancestor in [directory, *directory.parents]:
        if ancestor.is_symlink():
            raise SystemExit(f'Reconcile symlink directory before removal: {ancestor}')
for file in files:
    for ancestor in file.parents:
        if ancestor.is_symlink():
            raise SystemExit(f'Reconcile symlink ancestor before removal: {ancestor}')
for folder in folders:
    if folder.is_symlink():
        raise SystemExit(f'Reconcile symlink directory before removal: {folder}')
    if folder.is_dir():
        files += list(folder.iterdir())
remove = set()
def identity(file):
    return ('link', os.readlink(file)) if file.is_symlink() else ('file', hashlib.sha256(file.read_bytes()).hexdigest())
def question(prompt):
    with open('/dev/tty', 'r') as terminal:
        print(prompt, end='', flush=True)
        return terminal.readline().strip().lower()
for file in set(files):
    if file.is_symlink():
        target = Path(os.path.abspath(file.parent / os.readlink(file)))
        if target == legacy or legacy in target.parents:
            print(f'Candidate link: {file} -> {target}')
            if question('After historical comparison, type owned only for a proven old Toolkit link: ') != 'owned':
                raise SystemExit('Link ownership unresolved; no removal performed. Preserve it and reconcile manually.')
            remove.add(file)
        continue
    marker = Path(str(file) + '.agent-toolkit.sha256')
    if not marker.exists():
        continue
    if (marker.is_symlink() or not marker.is_file() or not file.is_file()
            or hashlib.sha256(file.read_bytes()).hexdigest() != marker.read_text().strip()):
        raise SystemExit(f'Modified or ambiguous resource; no removal performed: {file}')
    remove.update([file, marker])
identities = {file: identity(file) for file in remove}
for file in sorted(remove):
    print(file)
if not remove:
    print('No proven legacy links or marked files in the selected homes.')
else:
    answer = question('Remove exactly these classified links and marked files? [y/N] ')
    if answer == 'y':
        for file in sorted(remove):
            if identity(file) != identities[file]:
                raise SystemExit(f'Resource changed after inspection; no removal performed: {file}')
        for file in sorted(remove):
            file.unlink()
        print('Removed the listed legacy resources. Provider configuration stays unchanged.')
PY
```

5. Inspect `~/.local/libexec/agent-toolkit` against the private snapshot.
6. Move any unrelated or modified work to its proper user-owned location.
7. Verify that the remaining directory contains only the retired Toolkit runtime, copied resources, dependencies, and ownership sidecars.
8. After this ownership check and a successful backup, remove that exact directory:

```sh
rm -r "$HOME/.local/libexec/agent-toolkit"
```

Do not use this command if that path is a symlink or its ownership is unresolved.
Do not remove `~/.local/share/agent-toolkit` wholesale. It can contain installation receipts and private recovery backups.
If a rebuilt installation also exists, this legacy-only procedure does not uninstall it. Inspect its `installed.json` separately.
Do not erase its receipt before reconciling its recorded links and instruction blocks.
Preserve `paseo/tool-approvals/`, official Paseo skills, user databases, and active PostgreSQL fixtures.

9. Verify that old explicit configuration references, aliases, wrappers, and symlinks no longer select the legacy runtime.
Inspect mixed instruction files for old Toolkit sections. Remove only the compared Toolkit text and preserve human instructions.
An account's `AGENTS.md` can link to a shared user instruction file instead of the legacy runtime.
Do not classify that link as Toolkit-owned. The installer refuses it rather than following it into another home.
Reconcile it separately. Preserve the target's user text if you deliberately replace the link with a standalone account instruction file.
10. Reopen a trusted terminal and verify that normal `codex`, `claude`, and `pi` commands select the intended native CLIs.
11. Proceed with the fresh installation below.

Do not restore whole global configuration files from old backups after removal.
Restore only a needed, compared setting. Whole-file restoration can reactivate retired hooks or permissions.

## Install from a fresh checkout

Keep the current checkout intact. Use a new destination that does not already exist:

```sh
git clone --recurse-submodules https://github.com/hendrikeng/agent-toolkit.git \
  "$HOME/Code/wewereyoung/agent-toolkit-fresh"
cd "$HOME/Code/wewereyoung/agent-toolkit-fresh"
npm ci --prefix shared --ignore-scripts --no-audit --no-fund
./verify.sh
./install.sh
```

Use Node.js 24 and the supported provider versions described in the README.
Set the same provider-home overrides that the intended sessions use before installation.
Repeat installation for additional homes. Existing homes and their ownership records remain intact.

If preflight names a conflict, stop and compare that exact resource with its ownership record and backups.
Preflight refusal deploys no Toolkit resources. Do not resolve it by deleting a directory or the receipt.
Recognized old launchers, rules, and discovery links also retire through the installer if you choose migration instead of complete legacy removal.
The complete-removal route above removes the old snapshot after its ownership check.
Keep private historical backups until acceptance succeeds.

Retiring custom restrictions removes Toolkit's extra filesystem, secret, network, and Pi sandbox constraints.
Native permissions remain authoritative. Approval prompts are not an OS sandbox.

Run `./install.sh` a second time and inspect the result.
Verify that human instructions, accounts, permissions, unrelated skills, and other provider homes remain intact.
Each updated startup file must contain one owned `<!-- agent-toolkit -->` block.
Skill links must resolve to copied resources under `~/.local/share/agent-toolkit/resources`, not either checkout.

## Optional Paseo setup

Keep the selected local daemon running, with its profile editor idle:

```sh
./setup-paseo.sh
```

Select the intended account aliases and native permission modes. Skip a provider family with `-` if you do not use it.
Setup adds missing profiles, with private backups. Its separate context choice defaults to off.
Select the small owned `daemon.appendSystemPrompt` block for default primary orchestration or missing host and guidance references.
It preserves existing profiles and human prompt text. It does not enable tools, change credentials, or launch workers.
Repeat setup to verify that unchanged configuration produces no writes.
If setup reports a partial save or an unapplied change, inspect its backup before recovery. Do not blindly retry.

The extra prompt supplies Paseo ownership, default primary orchestration, and references to role guidance. Task skills do not require it.
Explicit roles, native Plan mode, and delegated assignments take precedence over the primary default.
The native provider instruction files already supply shared coding and review rules.
Tool access requires deliberate host enablement and official Paseo skills through Paseo's supported settings.
Install or update those official skills through Paseo, never through a duplicate Toolkit copy.
Start fresh sessions after deployment. Resumed sessions can retain old instructions and their original host owner.

## Fresh-session tests

Passing fixture checks does not prove live instruction loading or effective permissions.
Record the selected host, provider/account alias, model, effort, mode, features, and result for each trial.
Run the common trials in fresh Codex, Claude, and Pi sessions that you actually use.
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
printf '// ponytail: one locale, add translation when a second locale is required\n' > debt.cjs
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
| `python` | In a disposable Python project: `Explain this Python function and propose a bounded correction. Do not edit or install anything.` | Full applicable skill read. Inspect task behavior separately. |
| `fastapi` | In a disposable FastAPI project: `Inspect one route and its dependencies. Propose a compatible correction without editing or upgrading anything.` | Python and FastAPI reads, with repository version checks. |
| `fastify` | In a disposable Fastify project: `Inspect one Fastify route and its schema. Recommend the smallest compatible correction. Do not edit or start a server.` | Full Fastify read and relevant rule references. |
| `vue` | In a disposable Vue project: `Inspect this Vue component's reactivity and propose a bounded correction. Do not edit or start a server.` | Full Vue read and relevant references. |
| `ponytail-review` | `Review the fixture diff for unnecessary complexity. Report findings only.` | Explicit skill read, no edits or automatic publication. |
| `autoreview` | `Explicitly review this disposable repository's local diff with the installed Codex AutoReview skill and helper. Use gpt-6.1-sol at high effort. Keep normal permissions. Do not edit, commit, or push.` | Isolated helper invocation and validated report. A denial leaves this trial unverified. |
| `ponytail-audit` | `Run Ponytail Audit on this disposable repository. Report only.` | Full skill read and a scoped report, no fixes. |
| `ponytail-debt` | `Report the Ponytail Debt in this disposable repository.` | Real `debt.cjs` marker, no configuration change. |
| `ponytail-help` | `Show Ponytail Help.` | Current native syntax, modes, and update guidance. |
| `deepsec` | `Load DeepSec and run only its read-only plan command. Do not scaffold, install, scan, or invoke AI.` | Installed wrapper's local plan, no AI charges or dependency download. |
| `react-doctor` | `Load React Doctor and explain its pinned changed-scan command. Do not run or install anything.` | Full manual skill read. A real scan needs a separately authorized React fixture. |

Use existing disposable framework projects; do not add framework dependencies just to produce discovery evidence.
Framework detection and body reads do not prove the correctness of every framework recommendation.
Unrequested DeepSec and React Doctor must remain idle during ordinary work.
An explicit AutoReview still works with `reviews:off`; native approval review is a separate mechanism.

### Publication review gates

Use two identical disposable repositories with a prepared installation-code change that qualifies for the AutoReview risk gate.
Use a deterministic regression and a complexity change that also qualifies for Ponytail Review if you need to verify both gates.
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

Verify that the enabled trial invokes the applicable installed review skills and helper before the local commit.
Verify that the disabled trial runs deterministic checks and commits without an automatic Toolkit review.
Then explicitly request AutoReview under `reviews:off` on a fresh matching fixture.
That explicit request must still use the helper and normal approval. A denial leaves invocation unverified.
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
| Browser | Use an enabled Paseo browser host on an authorized local UI fixture. | Actual Paseo browser operations; no switch to Orca. |
| Handoff | Explicitly authorize a disposable handoff through the official skill. | Receiving scope, dirty-file context, review mode, publication limits, and retained recipient. |

Repeat applicable role trials for both Codex and Claude. Pi retains its own native capabilities and interfaces.
Prompt compliance is separate from an enforced sandbox. Inspect effective native permissions and use only authorized harmless boundary probes.
Keep failed or unresolved trials and their evidence until the cause is clear.

### Pi interfaces and PostgreSQL helpers

These capabilities require their actual runtime. The shared skill trials do not establish their acceptance.

| Capability | Human-controlled trial | Acceptance |
|---|---|---|
| Pi blueprint | `/project audit .` in a disposable suitable project | Pinned blueprint and read-only report. Adopt/update/new need explicit fixture approval. |
| Pi accounts | Select two existing test accounts in independent terminal sessions | Account continuity, independent concurrent requests, resume/model choices, unchanged other credentials. Do not add a login as an incidental test. |
| Pi Fast | `/fast status`, then deliberate off/on/off selections | Persisted intended state and model support; on uses more quota. |
| Pi side | `/side` and `/side close` in terminal UI | Separate conversation, inherited account/review state, normal workspace permissions. Terminal-only. |
| Pi clipboard | `/copy-code` on a known response | Exact clipboard content on the host running Pi. |
| Pi reviews | `/reviews off`, `/reviews`, `/reviews auto` | Deliberate session persistence and side-conversation inheritance. |
| Pi web | `/web status`, `/web on`, one bounded lookup, `/web off` | Actual on-demand tools, preserved user settings, no cookie import. |
| Pi publication | `/push` and `/pr` only in an explicitly authorized disposable remote | Confirmation and exact target. Explanation alone does not verify publication. |
| PostgreSQL | `pg-test start`, returned URL, `pg-test status <id>`, `pg-test stop <id>` | PG18 fixture identity, least-privileged role, actual stop. Use only its URL. |
| PostgreSQL profiles | Separately authorized migration/admin fixtures | Intended role permissions and cleanup, no production target. |
| Fresh PostgreSQL suite | `pg18-fresh` only in its supported reviewed inventory-suite repository | Actual Docker isolation, bounded inventory, invocation-owned cleanup. Otherwise mark unavailable. |

Safe garbage-collection identity and age behavior have deterministic fixture coverage.
Do not run `pg-test gc` blindly when unrelated historical fixtures can exist.
Do not make a new database, publish a PR, or incur scan charges merely to mark a checklist complete.

Record each result as passed, failed, or unverified, with its command, event, report, or effective settings.
Report authentication and permission failures without switching accounts, broadening permissions, or copying credentials.
The acceptance evidence determines which capabilities are ready to rely on.
