import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
	configuredPushTarget,
	escapeControlCharacters,
	isSupportedSshPushUrl,
	stripFinalLineEnding,
	unsafeGitEnvironmentVariable,
} from "./git-push-core.ts"

const TOOL_NAME = "push_current_branch"
const PUSH_PROMPT =
	"The user invoked the trusted /push command. Prepare the current repository for push now: inspect the outgoing bundle and follow the AGENTS.md risk-gated closeout exactly, using only focused deterministic checks and only triggered reviews. Do not run git push through bash. If closeout succeeds, call push_current_branch as the sole final tool; otherwise report the blocker without calling it."
const REAL_GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"]
const SAFE_GIT_ARGS = [
	"--no-replace-objects",
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.sshCommand=/usr/bin/ssh",
	"-c",
	"protocol.ext.allow=never",
	"-c",
	"push.gpgSign=false",
	"-c",
	"push.pushOption=",
	"-c",
	"gpg.program=/usr/bin/false",
	"-c",
	"diff.external=",
]

function realGit(): string {
	const git = REAL_GIT_CANDIDATES.find(existsSync)
	if (!git) throw new Error("Real Git executable is unavailable")
	return git
}

export default function gitPushExtension(pi: ExtensionAPI) {
	let waiting = false
	let pending = false
	let armed = false
	let dispatchTimeout: ReturnType<typeof setTimeout> | undefined

	async function git(cwd: string, args: string[], timeout = 30_000, signal?: AbortSignal): Promise<string> {
		const result = await pi.exec(realGit(), [...SAFE_GIT_ARGS, "-C", cwd, ...args], { timeout, signal })
		if (result.killed) throw new Error(`git ${args[0]} timed out`)
		if (result.code !== 0) {
			throw new Error(escapeControlCharacters((result.stderr || result.stdout).trim()) || `git ${args[0]} failed`)
		}
		return stripFinalLineEnding(result.stdout)
	}

	async function optionalBooleanConfig(cwd: string, key: string, signal?: AbortSignal): Promise<string | undefined> {
		const result = await pi.exec(
			realGit(),
			[...SAFE_GIT_ARGS, "-C", cwd, "config", "--bool", "--get", key],
			{ timeout: 30_000, signal },
		)
		if (result.killed) throw new Error("git config timed out")
		if (result.code === 1) return undefined
		if (result.code !== 0) {
			throw new Error(escapeControlCharacters((result.stderr || result.stdout).trim()) || "git config failed")
		}
		return stripFinalLineEnding(result.stdout)
	}

	async function resolveTarget(repo: string, branch: string, signal?: AbortSignal) {
		const remote = await git(repo, ["config", "--get", `branch.${branch}.remote`], 30_000, signal)
		const mergeRef = await git(repo, ["config", "--get", `branch.${branch}.merge`], 30_000, signal)
		const target = configuredPushTarget(
			remote,
			mergeRef,
			(await git(repo, ["remote"], 30_000, signal)).split("\n").filter(Boolean),
		)
		if (!target) throw new Error("Current branch has no supported configured upstream")
		if ((await optionalBooleanConfig(repo, `remote.${target.remote}.mirror`, signal)) === "true") {
			throw new Error(`Mirror remote ${target.remote} is not supported`)
		}
		const pushUrls = (await git(repo, ["remote", "get-url", "--push", "--all", target.remote], 30_000, signal))
			.split("\n")
			.filter(Boolean)
		if (pushUrls.length !== 1) throw new Error(`${target.remote} must have exactly one push URL`)
		if (!isSupportedSshPushUrl(pushUrls[0])) throw new Error(`Only SSH push URLs are supported: ${escapeControlCharacters(pushUrls[0])}`)
		const trackingRef = await git(repo, ["rev-parse", "--symbolic-full-name", "@{upstream}"], 30_000, signal)
		if (!trackingRef.startsWith("refs/remotes/")) throw new Error(`Unsupported tracking ref: ${escapeControlCharacters(trackingRef)}`)
		return { ...target, upstream: `${target.remote}/${target.branch}`, pushUrl: pushUrls[0], trackingRef }
	}

	function deactivate(): void {
		if (dispatchTimeout) clearTimeout(dispatchTimeout)
		dispatchTimeout = undefined
		waiting = false
		pending = false
		armed = false
		pi.setActiveTools(pi.getActiveTools().filter((name) => name !== TOOL_NAME))
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: "Push Current Branch",
		description: "Preview, confirm, and push the current commit after the user invoked /push and required closeout passed",
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (!armed) throw new Error("Push is not armed; the user must invoke /push")
			const runGit = (cwd: string, args: string[], timeout = 30_000) => git(cwd, args, timeout, signal)

			try {
				const unsafeEnvironment = unsafeGitEnvironmentVariable(process.env)
				if (unsafeEnvironment) throw new Error(`Unset ${unsafeEnvironment} before using /push`)
				const repo = await runGit(ctx.cwd, ["rev-parse", "--show-toplevel"])
				if (await runGit(repo, ["status", "--porcelain", "--untracked-files=all"])) {
					throw new Error("Commit or discard local changes before pushing")
				}

				const branch = await runGit(repo, ["branch", "--show-current"])
				if (!branch) throw new Error("Cannot push from detached HEAD")
				const target = await resolveTarget(repo, branch, signal)
				const expectedUpstreamCommit = await runGit(repo, ["rev-parse", target.trackingRef])

				const [behind, ahead] = (await runGit(repo, ["rev-list", "--left-right", "--count", `${expectedUpstreamCommit}...HEAD`]))
					.split(/\s+/)
					.map(Number)
				if (behind) throw new Error(`Current branch is ${behind} commit(s) behind ${target.upstream}; update it before pushing`)
				if (!ahead) return { content: [{ type: "text" as const, text: "No commits to push" }], details: {}, terminate: true }

				const commit = await runGit(repo, ["rev-parse", "HEAD"])
				const commits = (await runGit(repo, ["log", "--oneline", "--max-count=10", `${expectedUpstreamCommit}..${commit}`]))
					.split("\n")
					.map(escapeControlCharacters)
					.join("\n")
				const confirmed = await ctx.ui.confirm(
					"Push current branch?",
					`${escapeControlCharacters(repo)}\n${escapeControlCharacters(branch)} → ${escapeControlCharacters(target.upstream)}\n${escapeControlCharacters(target.pushUrl)}\n${ahead} outgoing commit(s):\n\n${commits}`,
				)
				if (!confirmed) return { content: [{ type: "text" as const, text: "Push cancelled" }], details: {}, terminate: true }
				if (ahead > 10 && !(await ctx.ui.confirm("Push all outgoing commits?", `Only the newest 10 of ${ahead} commits were shown. Push all ${ahead}?`))) {
					return { content: [{ type: "text" as const, text: "Push cancelled" }], details: {}, terminate: true }
				}

				const confirmedTarget = await resolveTarget(repo, branch, signal)
				if (
					(await runGit(repo, ["branch", "--show-current"])) !== branch ||
					(await runGit(repo, ["rev-parse", "HEAD"])) !== commit ||
					(await runGit(repo, ["rev-parse", target.trackingRef])) !== expectedUpstreamCommit ||
					(await runGit(repo, ["status", "--porcelain", "--untracked-files=all"])) ||
					JSON.stringify(confirmedTarget) !== JSON.stringify(target)
				) {
					throw new Error("Repository or push target changed after confirmation; run /push again")
				}

				const literalPushUrl = `agent-toolkit-push-${randomUUID()}://confirmed`
				const output = await runGit(
					repo,
					[
						"-c",
						"push.followTags=false",
						"-c",
						"push.recurseSubmodules=no",
						"-c",
						`url.${target.pushUrl}.insteadOf=${literalPushUrl}`,
						"-c",
						`url.${target.pushUrl}.pushInsteadOf=${literalPushUrl}`,
						"push",
						"--no-verify",
						"--porcelain",
						"--no-signed",
						`--force-with-lease=refs/heads/${target.branch}:${expectedUpstreamCommit}`,
						"--recurse-submodules=no",
						"--receive-pack=git-receive-pack",
						literalPushUrl,
						`${commit}:refs/heads/${target.branch}`,
					],
					120_000,
				)
				let text = escapeControlCharacters(output) || `Pushed ${commit.slice(0, 12)} to ${target.upstream}`
				try {
					await runGit(repo, ["update-ref", target.trackingRef, commit, expectedUpstreamCommit])
				} catch (error) {
					text += `\nPush succeeded, but the local tracking ref was not updated: ${escapeControlCharacters(error instanceof Error ? error.message : String(error))}`
				}
				return {
					content: [{ type: "text" as const, text }],
					details: { commit, upstream: target.upstream },
					terminate: true,
				}
			} finally {
				deactivate()
			}
		},
	})

	pi.registerCommand("push", {
		description: "Run required closeout, then confirm and push the current branch",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("/push accepts no arguments", "error")
				return
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/push is available only as an interactive user command", "error")
				return
			}
			if (waiting || armed) {
				ctx.ui.notify("A push is already pending", "warning")
				return
			}
			if (pending) deactivate()

			waiting = true
			try {
				await ctx.waitForIdle()
				waiting = false
				pending = true
				pi.setActiveTools([...new Set([...pi.getActiveTools(), TOOL_NAME])])
				dispatchTimeout = setTimeout(() => {
					if (pending && !armed) deactivate()
				}, 300_000)
				pi.sendUserMessage(PUSH_PROMPT)
			} catch (error) {
				deactivate()
				ctx.ui.notify(escapeControlCharacters(error instanceof Error ? error.message : String(error)), "error")
			}
		},
	})

	pi.on("before_agent_start", (event) => {
		if (pending) {
			if (event.prompt === PUSH_PROMPT) {
				if (dispatchTimeout) clearTimeout(dispatchTimeout)
				dispatchTimeout = undefined
				pending = false
				armed = true
			} else {
				deactivate()
			}
		} else if (armed) {
			deactivate()
		}
	})
	pi.on("agent_settled", () => {
		if (armed) deactivate()
	})
	pi.on("session_shutdown", () => deactivate())
	pi.on("session_start", () => deactivate())
}
