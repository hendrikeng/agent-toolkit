# Orca sessions

This guidance applies only when Orca owns the current session. Orca owns its workspaces, terminals, workers, and lifecycle.
Load the installed version-matched `orca-cli` skill for worktrees, terminals, and full handoffs.
Load `orchestration` for supervised workers and task DAGs. Do not delegate simple work just because agents are available.
Use normal provider commands (`codex`, `claude`, `pi`). A worktree does not require a Toolkit launcher.
Honor the user's account, provider, model, reasoning, and permission choices. Do not invent worker defaults.
Give workers a scope, edit ownership, constraints, shared coding/review guidance, and observable acceptance criteria.
Use separate host-managed worktrees for independent parallel edits. Reuse workers for follow-up work where appropriate.

For embedded browser interaction, use Orca's browser through `orca-cli`.
For an external browser or native window, use the installed computer-use guidance or page automation as appropriate.
Use web search/fetch for research and GitHub CLI inspection for PRs and Actions.
Do not add automatic socket or sandbox exceptions. Host terminal brokers can run outside a provider sandbox.

Collect results and check evidence before integration or cleanup. Preserve unresolved changes and report retained resources.
Follow Orca's settlement, retention, and release procedures. Never clean up Paseo-owned resources or the current user workspace.
A handoff transfers ownership with full context and acceptance criteria. Do not also supervise the recipient as disposable work.
