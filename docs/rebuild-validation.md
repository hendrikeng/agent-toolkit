# Rebuild validation

## Baseline and scope

On 2026-10-05 the checkout was clean at `7de4543`. Git status, staged/unstaged diffs, and the untracked-file inventory contained no abandoned refactor changes to discard. The archived baseline is `/private/tmp/agent-toolkit-baseline-LubBIu/`: an empty working-tree patch, a baseline note, the complete committed README, and the complete `b1d84f7^` README. No reset or untracked-file deletion was needed.

The initial live installation differed from committed code: providers linked skills and extensions to an older unmanifested `~/.local/libexec/agent-toolkit/resources/` snapshot. That snapshot, wrapper files, global settings, existing credentials, official skills, and account homes were inspected read-only. They were not replaced, repaired, or executed as migration actions.

## Architecture and retained behavior

`pg18-fresh` has a separate demonstrated requirement: run a particular fresh-install suite with source mounted read-only and no test-phase network, then export a bounded inventory. Its Docker isolation is retained as a direct helper. The old host-path restriction was replaced with a home/root refusal so native Paseo repository workspaces are supported. No provider receives a sandbox exception.

### Useful behavior extracted from old origin

The old documentation rule excluded instruction and prompt files. The new rule includes Markdown instruction files as requested. It applies to prose and preserves code, commands, paths, identifiers, and quoted output. Ordinary replies use blockquotes only for quotations or an explicit request, as in the old policy.

### Follow-up omission check

Audit provides a whole-repository complexity report. Debt collects actual shortcut comments and their revisit conditions. Help explains modes and native provider syntax. These three are useful optional interfaces, not prerequisites for correct coding. Their bodies load on demand, with no executable plugin hooks or independent reviewer launches. Help now describes Toolkit installation and updates; its obsolete plugin configuration, `@` command syntax, and plugin auto-update instructions were removed. Debt uses ripgrep and excludes examples from its ledger.

Gain was not retained after the user prioritized a proper minimal setup. Its only function was a historical benchmark card. The upstream 4.9.0 skill still showed older single-shot figures that the same revision's README says were superseded. This supplies no operational behavior needed by Toolkit.

## Current installation blockers

Run installation and any necessary cleanup only from a trusted human terminal. The new preflight refuses these ambiguous conflicts before deployment. No decision about their ownership is required to review the source rebuild.

### Read-only setup check on 2026-10-06

The GitHub repository page, raw README, and GitHub API were unavailable from this session. Documentation changes used the complete local replacement, committed README, and pre-sandbox README. No claim was made that the current remote README was fetched.

## Checks and evidence

The user then selected PostgreSQL 18 for all new fixtures. The helper's version selector and duplicate PG17 creation checks were removed. All role profiles now use 18 without flags. One seeded historical PG17 lifecycle check retains status, stop, and age-based cleanup, including preservation when its binaries are missing. All 19 focused PostgreSQL/helper checks passed after this change. The preceding 118-check full run predates this simplification; the removed matrix reduces the current suite by three checks. No live fixture or installation was changed.

The first PostgreSQL fixture run failed because the running session blocks a loopback bind. No security escalation was attempted. Only the fixture's OS port-allocation boundary was substituted; real PostgreSQL startup remains unverified.

### Initial native Paseo profile research

The user requested an Orchestrator and paired Claude/Codex choices. The README now gives four paired roles: Orchestrator, Planner, Worker, and Adviser. These eight saved choices do not require eight concurrent agents. Ordinary tasks can stay with the Orchestrator. Code reviews use the existing isolated AutoReview helper, with explicit Codex or Claude options, rather than a second reviewer implementation.

Read-only inspection traced the installed profile form, persistence path, provider adapters, and native planning controls. Profiles contain launch settings and selection notes, without a worker system prompt. Codex uses the Plan feature; Claude uses its native Plan mode. Exact account aliases, explicit false feature values, and provider-specific permission choices must survive materialization. Neither a profile label nor an analysis assignment supplies OS isolation. The shared startup block and on-demand skills remain authoritative guidance.

An ephemeral check executed the installed editor's actual form-state module with a fixture catalog. It reproduced a displayed default Off value absent from the submitted settings. Setting On, then Off, submitted explicit false. Only label formatting and model-catalog filtering were substituted. Static tracing found no default insertion before configuration persistence, and profile selection merges omitted features with existing preferences. This proves the form-state case, not a saved GUI profile or effective live session. The README gives a conditional native-editor check; no Toolkit workaround or upstream regression suite was added.

The authorized native research committee used Sol and Astra for analysis only. Both analyses converged on the eight paired roles after the requested two-hour research window. Their final recommendations preserve human-selected native permissions, reserve planning controls for Planner, and keep AutoReview's helper. Planner notes specify a plan for later approval; Adviser notes specify a completed recommendation. No delegated source edits or further delegation were authorized. Their architecture findings do not constitute an AutoReview of this implementation. Saved profiles, installed resources, credentials, and permissions remain untouched.

### Profile effort reassessment — 2026-10-06

At the user's request, a new Sol/Astra committee independently reassessed the initial all-High recipe. Both analyses recommended Medium for Orchestrator, Worker, and Adviser, with High for substantial Planner work. Straightforward plans use Medium. Difficult integration, ambiguous architecture, security, concurrency, migrations, and difficult debugging justify High before launch. Low remains an optional adjustment for mechanical work with close supervision. These defaults are not measured optima.

Native discovery exposed Medium and High for Sol, Astra, and Opus 5.5. Codex's selected default remained High despite different raw metadata and API defaults. Opus 5.5's selected default was Medium. The recipe therefore requires explicit effort selection. Catalog inspection does not establish effective live effort or account entitlement.

At that stage, the README named eight recipes, with models, thinking levels, planning controls, and selection notes. Native creation remained human-managed. That investigation did not establish profile automation. The queried host returned no saved profiles. Shared host guidance requires an explanation for task-specific effort adjustments and preserves explicit human choices. AutoReview's helper effort remains separate, with High for risk-gated and substantive explicit reviews.

Both research agents were analysis-only and launched no further agents. No saved profiles, installation, account settings, or permissions changed. This reassessment changed documentation only. It did not compare actual task quality or usage at Medium versus High. Fresh-session acceptance and task-level calibration remain unverified.

## Limits and human acceptance

Installer checks substitute `EXDEV` at the filesystem boundary and verify repeated installation and rollback. They do not mount another physical filesystem. The output-path check executes review publication with a fixture reviewer and verifies that all reports reach the validated home paths. No report is written into the checkout's literal `~` directory.

The profile guide adds optional UI Worker choices and exact role instructions, for ten optional presets. Public Paseo 0.10.3 sources confirm that profiles have no system prompt, use whole-list configuration updates, and support a native administrative configuration API. The guide documents this supported automation route. Toolkit does not implement or run it. Live profile creation and acceptance remain unverified.

No push, publication, live install, saved-profile change, account login, permissions change, or paid scan was performed. Native host delegation was limited to the authorized architecture research above.

After human reconciliation and installation, perform the README's fresh-session acceptance steps in a disposable repository. Keep provider sandboxes enabled where desired; use normal approval paths. A permission denial is not a reason to repair or bypass the active session boundary.

## Cleanup validation — 2026-10-08

`./verify.sh` passed after the retired integrations were removed. This covers shell and JavaScript syntax, installer behavior, Paseo helpers, PostgreSQL fixtures, and 54 deterministic AutoReview checks.
Five focused hardening checks also passed with the installed Python 3.12.13 runtime. They cover supported reviewer engines, credential preservation, process injection, credential paths, and repository-local configuration refusal.
The acceptance runbook's shell and Python snippets passed syntax checks. `git diff --check` passed.

Local cleanup removed 219 obsolete fixture directories, 482 obsolete session folders, ten receipt-owned extension links, and six archived histories.
Scoped repository workers removed four obsolete temporary helpers. They preserved unrelated changes and returned exact file and status checks.
An inspection of 21 repositories found no remaining registrations for the removed host's worktrees.
The installed resource hash matches its ownership receipt after cleanup. No credentials or native permission configuration changed.
Fresh-session behavior and a live reviewer remain unverified. Refresh installed guidance from a trusted human terminal.

### Final source check

The final check removed a stale local Git submodule registration and two orphaned test decorators.
`./verify.sh` passed again. The complete AutoReview hardening suite ran 224 tests, with one platform-specific skip and no failures.
Changed Python files and relative Markdown links passed validation. `git diff --check` passed.
A read-only installation preflight passed against the selected provider homes. All receipt-owned links resolve to their recorded resources.

The legacy scratch and reports folders remain. No process had files open in either folder during inspection.
Other projects reference historical evidence there. The current Toolkit uses the session temporary directory for new fixtures.
The reports folder contains retained evidence. Scratch requires a separate ownership and retention check before complete removal.
