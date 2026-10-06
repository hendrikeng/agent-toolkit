# Rebuild validation

## Baseline and scope

On 2026-10-05 the checkout was clean at `7de4543`. Git status, staged/unstaged diffs, and the untracked-file inventory contained no abandoned refactor changes to discard. The archived baseline is `/private/tmp/agent-toolkit-baseline-LubBIu/`: an empty working-tree patch, a baseline note, the complete committed README, and the complete `b1d84f7^` README. No reset or untracked-file deletion was needed.

Ignored dependencies and unrelated `paseo/tool-approvals/` remain intact. There were no applicable checkout/ancestor repository instructions. The old `pi/AGENTS.md` was installed guidance, not an instruction file governing this checkout. Ponytail full, Test Audit, Python, Simple English, and the official installed host documentation informed the work.

The initial live installation differed from committed code: providers linked skills and extensions to an older unmanifested `~/.local/libexec/agent-toolkit/resources/` snapshot. That snapshot, wrapper files, global settings, existing credentials, official skills, and account homes were inspected read-only. They were not replaced, repaired, or executed as migration actions.

## Architecture and retained behavior

Shared skills moved to `skills/`; AutoReview moved with its upstream script, tests, and notices. Ponytail and Ponytail Review contain vendored text and licenses only. Small shared instructions select conditional Orca or native Paseo guidance. Official host skills are never installed by Toolkit.

The installer copies executable resources before linking discovery paths. It preserves native permission settings and models, appends exact managed instruction blocks, adds only missing pinned Pi packages/preferences, and backs up owned replacements. Changed or ambiguous resources stop installation. Deployment failures restore moved files. Native Pi's settings lock prevents a concurrent native settings writer from being overwritten. Ownership hashes are install bookkeeping, not a runtime integrity policy.

Deleted machinery includes provider `*-yolo` launchers, custom development policy/configuration, Pi Bash sandbox overrides, legacy context filtering, permission notification/status glue, global-skill blanket updates, and mirrored account runtimes. AutoReview's custom Pi review-root preflight was removed; the existing reviewer isolation stays. The obsolete PostgreSQL session watcher was removed; explicit cleanup, TTL collection, and legacy identity recognition remain.

The account interface has a demonstrated requirement: select an independent account for one running Pi session while sharing native settings/resources. It uses Pi's public `ModelRuntime` and native provider registration for credential resolution and locking. A one-time login import never deletes Codex tokens or overwrites an existing Pi account. There is no ongoing synchronization or launcher.

`pg18-fresh` has a separate demonstrated requirement: run a particular fresh-install suite with source mounted read-only and no test-phase network, then export a bounded inventory. Its Docker isolation is retained as a direct helper. The old host-path restriction was replaced with a home/root refusal so native Paseo repository workspaces are supported. No provider receives a sandbox exception.

The README accounts for the complete old feature inventory, including shared framework/writing skills; risk-gated and explicit reviews; Pi project/accounts/Fast/side/copy/publication/review/web interfaces; PostgreSQL profiles and cleanup; pins, installation, backups and updates; host delegation, browser routing, handoffs and lifecycle ownership.

### Useful behavior extracted from old origin

This comparison uses the local `origin/main` snapshot at `7de4543` and the complete `b1d84f7^` README. GitHub DNS prevented a fresh remote check. It covers the old startup policy, installer/configuration, review helper, Pi interfaces, and database helpers.

| Useful old behavior and source | Result in the rebuild |
|---|---|
| `pi/AGENTS.md`: read repository instructions, then load full Ponytail for coding and Test Audit for all test work | Required in the small shared startup block for every provider. Full skill bodies stay on demand. |
| Old Ponytail package: Audit, Debt, Gain, and Help alongside coding and diff review | Audit, Debt, and Help are restored as optional shared text-only skills. Gain is deliberately omitted because its historical scoreboard supplies no coding or review behavior. |
| `pi/AGENTS.md`, Documentation prose: read full Simple English before Markdown prose edits, without an explicit user request | Restored after the rebuild weakened it to requested documentation work. The new rule also covers reviews and audits, AGENTS.md, CLAUDE.md, SKILL.md, and Markdown prompt files. |
| Old Simple English frontmatter marked the skill manual-only; the startup policy still required a file read | Removed that flag and added automatic task descriptions. Pi now exposes the skill in its native model catalog when a file-read tool is available. Explicit commands still work. |
| `pi/AGENTS.md`, Test quality and Risk-gated review closeout: useful tests, no automatic AI review at task completion | Preserved. Requested publication boundaries use the original risk gates, review-off override, unchanged-bundle reuse, and advisory findings. No Git hooks. |
| `codex/skills/autoreview`: explicit Git targets, isolated reviewers, validated reports, access-only model fallback | Preserved in the shared skill-local helper. The sandbox-escape wrapper and custom report-access preflight are retired. |
| Python, FastAPI, Fastify, and Vue skills: concrete language/framework conventions | Preserved as shared skill resources. DeepSec and React Doctor remain explicit-request only. |
| `pi/extensions/project-blueprint`: pinned blueprint, evidence-based decisions, approved mutations, preservation of changed managed files | Preserved as Pi's `/project` interface. No invented Codex or Claude command. |
| `pi/extensions/codex-account`: independent accounts in concurrent Pi sessions | Preserved through native credential stores, refresh locks, and provider APIs. Existing credentials stay authoritative; no runtime mirroring or silent account fallback. |
| Pi Fast, side conversations, copy-code, push/PR, review mode, and web access | Preserved as Pi interfaces. Side messages stay outside the main conversation; edits still affect the workspace. Push/PR confirmation and on-demand web access remain. |
| PostgreSQL helpers: role profiles, fixture-only URLs, identity checks, retained logs, safe cleanup | Preserved with PostgreSQL 18 for all new clusters, as requested. The old 17/18 selector is removed. Existing PG17 fixtures retain safe management. `pg18-fresh` keeps its necessary read-only source mount and test-phase network isolation. |
| Host guidance: scoped workers, user account/model choices, host-specific browsers, complete handoffs, results before cleanup | Preserved in separate Orca/Paseo files. Official Paseo skills remain untouched. Blocked work, the current workspace, and handoff recipients are retained. |
| Permission-denial and database-target guidance | Restored in the shared block. A hard denial does not become permission through chat. Service/database tests require a known target, credentials, ownership, and cleanup. |
| Installer/update: pins, backups, configuration preservation, human-terminal deployment, fresh-session validation | Preserved and strengthened with copied resources and conservative ownership checks. Pi is optional. Official skills and global user packages are not blanket-updated. |

The old documentation rule excluded instruction and prompt files. The new rule includes Markdown instruction files as requested. It applies to prose and preserves code, commands, paths, identifiers, and quoted output. Ordinary replies use blockquotes only for quotations or an explicit request, as in the old policy.

The extraction does not restore forced worker models, yolo launchers, global skill updates, custom permission engines, or automatic sandbox exceptions. Retiring those restrictions removes Toolkit's workspace/secret/network constraints and Pi's forced OS sandbox. Native permissions control the resulting access. Permission approval alone is not an OS sandbox; the README explains the limits.

### Follow-up omission check

The old Pi Ponytail package declared `skills: ["./skills"]`, so it supplied six skills. The rebuild initially vendored only coding and diff review. The locally installed source identifies its release as 4.9.0 at `0a4dd63ad4541f4f655c4108a295916f3c1d8fda`; its only working-tree change was an unrelated untracked lockfile. Restored files were read from the committed revision, not that working-tree change.

Audit provides a whole-repository complexity report. Debt collects actual shortcut comments and their revisit conditions. Help explains modes and native provider syntax. These three are useful optional interfaces, not prerequisites for correct coding. Their bodies load on demand, with no executable plugin hooks or independent reviewer launches. Help now describes Toolkit installation and updates; its obsolete plugin configuration, `@` command syntax, and plugin auto-update instructions were removed. Debt uses ripgrep and excludes examples from its ledger.

Gain was not retained after the user prioritized a proper minimal setup. Its only function was a historical benchmark card. The upstream 4.9.0 skill still showed older single-shot figures that the same revision's README says were superseded. This supplies no operational behavior needed by Toolkit.

Comparison with the tracked old tool inventory found no further absent core interfaces. It did expose missing documentation for retained `inspect_pull_request`, confirmed `comment_on_pull_request`, copy-code arguments/shortcut, and the terminal-only `/side` interface. The README now distinguishes these Pi tools and UI limits. This inventory comparison does not establish runtime parity: accounts, external commands, native approvals, clipboard transport, and TUI/RPC support still need the fresh-session acceptance checks.

The ten installer checks passed with the optional skills present. The extended fresh native Pi SDK check passed after using the SDK's session-level idle wait for sequential command expansion. It resolves Audit, Debt, and Help to copied resources and verifies their complete bodies in actual outgoing requests. Model transport remains stopped before a call. The generic skill-creator validator remains unavailable because system Python lacks PyYAML. No live installation changed.

## Current installation blockers

These observations describe the installation inspected at the baseline, not user settings to delete automatically:

- Claude and Codex have active Ponytail plugin registrations. Pi has a Ponytail package registration. Their provenance must be compared with old backups before replacing coding hooks with shared skill text.
- Pi has explicit `~/.codex/skills/autoreview` and `~/.codex/skills/handoff` entries, plus the retired status-formatter integration. Native supported discovery should replace proven stale aliases. A user-owned handoff skill must be retained or deliberately reconciled.
- Native global Codex/Claude sandbox and approval settings exist. Toolkit does not assume ownership or remove them. No source edit changes those protections.
- The legacy resource snapshot lacks a new ownership receipt. It can contain unrelated changes and remains untouched. Recognized provider links can be archived; the snapshot itself needs manual comparison.
- Paseo configuration contains host labels alongside user provider configuration. No Toolkit prompt marker was observed. Labels, aliases, permissions, and provider choices remain untouched.

Run installation and any necessary cleanup only from a trusted human terminal. The new preflight refuses these ambiguous conflicts before deployment. No decision about their ownership is required to review the source rebuild.

### Read-only setup check on 2026-10-06

The human disabled Claude's user-scope Ponytail plugin. Its configuration now records `false`; its native sandbox remains enabled. The main `~/.codex` home and the selected Orca Codex account still record Ponytail as enabled. Other inspected account homes lack the rebuilt instruction block.

The new installation receipt is absent. Shared Toolkit skills are absent from `~/.agents/skills`, while the official Paseo skills are present. The existing Codex, Claude, and Pi Toolkit links still resolve to the old `~/.local/libexec/agent-toolkit/resources/` snapshot. Claude's global instruction file is absent; existing Codex and Pi guidance has no rebuilt block. Marked legacy provider/reviewer launchers remain installed.

Pi still has the old Ponytail package, explicit AutoReview/handoff skill paths, and the retired status integration. Its unrelated permission package remains present. No automatic removal was attempted.

Paseo's read-only MCP provider discovery reports Codex, Claude, and Pi as available. Its inspected configuration has no provider-home overrides, custom command overrides, or global appended system prompt. Existing host-label environment entries remain. Provider availability and official skill files do not prove Toolkit loading in a fresh session.

The standalone Paseo status command failed at `uv_uptime` with `EPERM`. No escalation or boundary bypass followed. The MCP inspection succeeded, but daemon process environment and fresh Codex/Claude startup loading remain unverified. Installed versions are Codex 0.160.0, Claude 2.1.289, Pi 0.99.2, Node 24.18.0, and system Python 3.9.6. The system Python is older than the recommended 3.11. AutoReview's default helper checks pass on it; TOML projection requires Python 3.11 or `tomli`.

The GitHub repository page, raw README, and GitHub API were unavailable from this session. Documentation changes used the complete local replacement, committed README, and pre-sandbox README. No claim was made that the current remote README was fetched.

## Checks and evidence

`./verify.sh` runs these focused, deterministic checks:

On 2026-10-06, before the PostgreSQL simplification below, all 118 checks passed (31 installer/native-Pi/PostgreSQL, 35 Pi interface, 52 AutoReview helper checks), with no skips. The complete run was repeated after the TOML, skipped-Pi, and documentation-trigger fixes below. Syntax and whitespace checks passed. No AI reviewer ran; the native Pi checks used the installed SDK with model transport stopped before a call.

Two regression cases exposed formatting-dependent TOML detection and Pi executable replacement during a shared-only install. Both failed before the fixes. The existing installer checks now cover active and disabled TOML tables, indentation, inline tables, dotted keys, and refusal of registrations without explicit disablement. The deployment check now changes actual source extension code between installs, preserves the code reached through existing Pi discovery links during repeated skips, preserves the Pi blueprint, and then verifies an explicit Pi installation updates the extension. The locked TOML and JSONC parsers replace formatting heuristics and the custom JSONC reader. Parser dependency preparation used integrity-checked archives from the existing cache, offline, inside the checkout and temporary storage.

The Simple English startup requirement and automatic metadata now cover Markdown documentation and instruction files. The existing fresh native Pi check enables its native read tool and verifies the actual outgoing catalog includes the discovered skill path, which resolves to the copied resource. Explicit native expansion still includes the full body. This establishes automatic eligibility, not a model's decision to read or obey the skill. The generic skill-creator validator could not run because system Python lacks PyYAML; no dependency was installed to change that environment.

The user then selected PostgreSQL 18 for all new fixtures. The helper's version selector and duplicate PG17 creation checks were removed. All role profiles now use 18 without flags. One seeded historical PG17 lifecycle check retains status, stop, and age-based cleanup, including preservation when its binaries are missing. All 19 focused PostgreSQL/helper checks passed after this change. The preceding 118-check full run predates this simplification; the removed matrix reduces the current suite by three checks. No live fixture or installation was changed.

The next installer regression exposed deletion of a previous Claude home's skills or Pi home's extensions when selecting another home. Both executable cases failed before the fix with missing first-home links. Cleanup now scopes obsolete receipt links to the discovery folders being updated, and deployment merges retained ownership with new links. The cases cover both homes' usable active resources, unchanged first-home instructions, obsolete-link cleanup in the selected home, return installation, skipped Pi with a different home, and preservation of a user-modified unselected link. Selecting that modified home still requires reconciliation. All ten installer checks and the fresh native Pi check passed; no live installation was changed.

- Actual installer API in disposable homes: initial/repeat installs; instruction and native-config preservation; official Paseo and user resources; credentials and account homes; web preferences; migration ownership refusal in every updated Codex account; commented/trailing-comma Claude and Paseo settings with byte preservation; missing Pi CLI with shared installation and preservation of existing Pi state/ownership; backups; installed/source separation; settings edits during staging; rollback after a real file collision. The three installer regression checks failed before their fixes and passed afterward on 2026-10-06.
- A fresh native Pi SDK process against a disposable installed snapshot: the native loader loads retained extensions without errors; `/skill:ponytail` and `/skill:test-audit` expand their full copied bodies into the outgoing request; `/simple-english` delegates through native skill expansion; Simple English appears in the outgoing automatic skill catalog; `/reviews off` changes the actual request; neither host's operational body is injected. Model transport and external downloads are disabled. This is stronger than a discovery listing, but does not prove a model follows those instructions.
- Actual installed Pi SDK credential storage: two independent profiles refresh concurrently with only OAuth exchange substituted. Updated credentials persist independently, existing Codex tokens remain, repeat import preserves refreshed Pi tokens, and credential symlinks are refused.
- Retained Pi interface checks and real pinned-blueprint update fixtures: preserve local files, decisions, and approval requirements across current and historical project layouts.
- PostgreSQL 18 helper fixtures: default version in all role profiles, identity validation, failure retention, dead/live owners, TTL cleanup, legacy roots, wrong-version refusal, and direct pg18-fresh container arguments/export/cleanup. An independently seeded historical PG17 record verifies safe status/stop/collection without creating a PG17 cluster. PostgreSQL processes, Docker, and OS port allocation are substituted.
- AutoReview's 52 deterministic helper tests and its real `--help` entry point. Upstream reviewer isolation tests use substituted provider process output; no AI reviewer was contacted.
- Shell/JavaScript syntax and `git diff --check`.

The first PostgreSQL fixture run failed because the running session blocks a loopback bind. No security escalation was attempted. Only the fixture's OS port-allocation boundary was substituted; real PostgreSQL startup remains unverified.

### Initial native Paseo profile research

The user requested an Orchestrator and paired Claude/Codex choices. The README now gives four paired roles: Orchestrator, Planner, Worker, and Adviser. These eight saved choices do not require eight concurrent agents. Ordinary tasks can stay with the Orchestrator. Code reviews use the existing isolated AutoReview helper, with explicit Codex or Claude options, rather than a second reviewer implementation.

The initial recipe used Sol for Codex orchestration, planning, and implementation, with Astra for bounded advice. Claude used Opus 5.5. High was provisional, not a measured optimum. Native discovery confirmed these model IDs and thinking options. [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning) and [Claude model guidance](https://code.claude.com/docs/en/model-config) support task-level effort comparison. Neither establishes this host's best default. [Paseo orchestration guidance](https://paseo.sh/docs/orchestration-workflows) and [agent-scaling research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) support scoped delegation and checking the integrated result. They do not establish an optimal saved-profile count for this setup.

Read-only inspection traced the installed profile form, persistence path, provider adapters, and native planning controls. Profiles contain launch settings and selection notes, without a worker system prompt. Codex uses the Plan feature; Claude uses its native Plan mode. Exact account aliases, explicit false feature values, and provider-specific permission choices must survive materialization. Neither a profile label nor an analysis assignment supplies OS isolation. The shared startup block and on-demand skills remain authoritative guidance.

An ephemeral check executed the installed native mode resolver. Five cases verified same-provider inheritance, explicit Claude planning, refusal of cross-provider inheritance, rejection of a Codex `plan` mode, and mode-free Pi creation. These are actual pure-function checks with fixture inputs, not fresh-session permission tests. AutoReview's engine/model/effort options were traced to provider arguments. They do not select a Paseo account alias.

An ephemeral check executed the installed editor's actual form-state module with a fixture catalog. It reproduced a displayed default Off value absent from the submitted settings. Setting On, then Off, submitted explicit false. Only label formatting and model-catalog filtering were substituted. Static tracing found no default insertion before configuration persistence, and profile selection merges omitted features with existing preferences. This proves the form-state case, not a saved GUI profile or effective live session. The README gives a conditional native-editor check; no Toolkit workaround or upstream regression suite was added.

The inspected app is Paseo 0.10.3. Its Pi adapter checks for `pi-mcp-adapter` before supplying MCP servers. The [0.11.0-beta.4 changelog](https://paseo.sh/changelog) includes native Pi 0.99 MCP injection and mode/thinking persistence fixes. Adapter presence and actual Pi tool access remain unverified. Claude's catalog supports Opus 5.5/High, but its attempted analysis launch failed with expired OAuth. Catalog availability does not prove authentication, quota, or runtime behavior. Existing Claude Ultracode preferences also require inspection; selecting High does not necessarily disable them.

The authorized native research committee used Sol and Astra for analysis only. Both analyses converged on the eight paired roles after the requested two-hour research window. Their final recommendations preserve human-selected native permissions, reserve planning controls for Planner, and keep AutoReview's helper. Planner notes specify a plan for later approval; Adviser notes specify a completed recommendation. No delegated source edits or further delegation were authorized. Their architecture findings do not constitute an AutoReview of this implementation. Saved profiles, installed resources, credentials, and permissions remain untouched.

The current complete `./verify.sh` run passed all 117 checks: 30 installer/native-Pi/PostgreSQL, 35 Pi interface, and 52 AutoReview helper checks. After the host-guidance changes, the ten installer checks and fresh native Pi check passed again. Syntax and whitespace checks passed. No new tests mirror the profile recipe; fresh-session acceptance remains necessary.

### Profile effort reassessment — 2026-10-06

At the user's request, a new Sol/Astra committee independently reassessed the initial all-High recipe. Both analyses recommended Medium for Orchestrator, Worker, and Adviser, with High for substantial Planner work. Straightforward plans use Medium. Difficult integration, ambiguous architecture, security, concurrency, migrations, and difficult debugging justify High before launch. Low remains an optional adjustment for mechanical work with close supervision. These defaults are not measured optima.

Native discovery exposed Medium and High for Sol, Astra, and Opus 5.5. Codex's selected default remained High despite different raw metadata and API defaults. Opus 5.5's selected default was Medium. The recipe therefore requires explicit effort selection. Catalog inspection does not establish effective live effort or account entitlement.

At that stage, the README named eight recipes, with models, thinking levels, planning controls, and selection notes. Native creation remained human-managed. That investigation did not establish profile automation. The queried host returned no saved profiles. Shared host guidance requires an explanation for task-specific effort adjustments and preserves explicit human choices. AutoReview's helper effort remains separate, with High for risk-gated and substantive explicit reviews.

Both research agents were analysis-only and launched no further agents. No saved profiles, installation, account settings, or permissions changed. This reassessment changed documentation only. It did not compare actual task quality or usage at Medium versus High. Fresh-session acceptance and task-level calibration remain unverified.

## Limits and human acceptance

The user requested AutoReview and a commit after the architecture research. The installed Codex AutoReview helper ran through normal native approval with GPT-6.1 Sol and High reasoning. Its six-pass review completed with one P1 and two P2 findings. All three defects were confirmed: default Pi OAuth credentials blocked account selection, cross-filesystem backups failed, and review outputs did not use their validated paths. The regression checks failed before their fixes.

The Pi account check now uses the installed native SDK's actual authentication resolver and a fresh session. It covers independent account stores, startup selection, account switching, model changes, thinking preservation, and unchanged default credentials. Only OAuth exchanges and UI output are substituted. A separate native provider entry prevents credential precedence from changing the default login. Native Pi still owns refresh and locking.

After these fixes, `./verify.sh` passed all 119 checks: 31 installer/native-Pi/PostgreSQL, 35 Pi interface, and 53 AutoReview helper checks. Syntax and whitespace checks passed.

The follow-up review found two Pi resume defects and a submodule snapshot trust-boundary defect. A new untracked `untitled.md` appeared during that review. AutoReview refused to publish a final report because the source snapshot changed. That file is preserved and excluded from the Toolkit candidate.

Native SDK checks now cover session-local account recording, resumed account/model choices after defaults change, and explicit native launch overrides. Recursive submodule snapshots keep the original checkout as their Git executable/environment trust anchor. The parent-checkout executable regression failed before the fix. Eleven existing snapshot and linked-worktree checks passed in a disposable Python environment with pinned `tomli` 2.2.1. The full verification run passed 120 checks: 31 installer/native-Pi/PostgreSQL, 35 Pi interface, and 54 AutoReview helper checks.

Installer checks substitute `EXDEV` at the filesystem boundary and verify repeated installation and rollback. They do not mount another physical filesystem. The output-path check executes review publication with a fixture reviewer and verifies that all reports reach the validated home paths. No report is written into the checkout's literal `~` directory.

A separate candidate worktree made the next six-pass review independent of concurrent edits. Its validated report identified four P2 defects: Pi extension reload, profile-only startup, an expiring deployment lock, and legacy Pi skill settings. Native SDK regressions reproduced both account defects before fixes. The selected account now survives reload and initializes its saved model and effort without a main login. Explicit thinking arguments remain authoritative.

The installer now holds Pi's lock only during the final settings replacement, as the native settings writer does. Resource deployment and hashing happen before this short critical section. A changed settings snapshot aborts replacement and rolls back other installed resources. A real native Pi settings writer reproduced the lost-save defect with simulated lock expiry. The regression now preserves that save during rollback. Legacy skill directories and command preferences follow Pi's supported migration format. Both installer regressions failed before fixes.

The full verification run passed 122 checks: 33 installer/native-Pi/PostgreSQL, 35 Pi interface, and 54 AutoReview helper checks. The final review covers these accepted fixes against the previously reviewed candidate. The user endorsed concurrent profile documentation, so the final candidate also includes that guide and its README links. Unrelated untracked files remain outside the candidate.

The profile guide adds optional UI Worker choices and exact role instructions, for ten optional presets. Public Paseo 0.10.3 sources confirm that profiles have no system prompt, use whole-list configuration updates, and support a native administrative configuration API. The guide documents this supported automation route. Toolkit does not implement or run it. Live profile creation and acceptance remain unverified.

No push, publication, live install, saved-profile change, account login, permissions change, or paid scan was performed. Native host delegation was limited to the authorized architecture research above. Test fixtures can create temporary Git commits as part of blueprint checks.

Still unverified: fresh installed Codex/Claude skill loading; normal Pi CLI/TUI behavior with real account authentication; model adherence; automatic review selection in fresh provider sessions; real Docker/pg18-fresh and Homebrew PostgreSQL execution; Orca/Paseo worker and browser lifecycle in connected hosts. The SDK checks verify Pi's actual skill expansion and account flow, not these broader claims.

After human reconciliation and installation, perform the README's fresh-session acceptance steps in a disposable repository. Keep provider sandboxes enabled where desired; use normal approval paths. A permission denial is not a reason to repair or bypass the active session boundary.
