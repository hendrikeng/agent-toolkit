import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Type } from "typebox"
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent"
import {
	configuredPushTarget,
	defaultPushTarget,
	escapeControlCharacters,
	gitEnvironmentVariablesToUnset,
	githubRepository,
	isSupportedSshPushUrl,
	stripFinalLineEnding,
} from "./git-push-core.ts"

const PUSH_PROMPT =
	"Push the current branch. Inspect the outgoing bundle and follow the AGENTS.md risk-gated closeout exactly. Use only focused deterministic checks and triggered reviews. Then call push_current_branch."
const PR_PROMPT =
	"Create a pull request for the current branch. Follow the AGENTS.md risk-gated closeout exactly. Read the applicable repository pull request template, fill every relevant section, and call create_pull_request with the completed body."
const REAL_GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"]
const REAL_GH_CANDIDATES = ["/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh"]
const ENV = "/usr/bin/env"
const GITHUB_REPOSITORY_PATTERN = "^github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"
const SAFE_GIT_ARGS = [
	"--no-replace-objects",
	"-c",
	"core.fsmonitor=false",
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

function executable(candidates: readonly string[], name: string): string {
	const path = candidates.find(existsSync)
	if (!path) throw new Error(`${name} executable is unavailable`)
	return path
}

export default function gitPushExtension(pi: ExtensionAPI) {
	function sanitizedExec(command: string, args: string[], timeout: number, signal?: AbortSignal) {
		const unset = gitEnvironmentVariablesToUnset(process.env).flatMap(name => ["-u", name])
		return pi.exec(ENV, [...unset, command, ...args], { timeout, signal })
	}

	async function git(cwd: string, args: string[], timeout = 30_000, signal?: AbortSignal): Promise<string> {
		const result = await sanitizedExec(executable(REAL_GIT_CANDIDATES, "Git"), [...SAFE_GIT_ARGS, "-C", cwd, ...args], timeout, signal)
		if (result.killed) throw new Error(`git ${args[0]} timed out`)
		if (result.code !== 0) {
			throw new Error(escapeControlCharacters((result.stderr || result.stdout).trim()) || `git ${args[0]} failed`)
		}
		return stripFinalLineEnding(result.stdout)
	}

	async function optionalGit(cwd: string, args: string[], signal?: AbortSignal): Promise<string | undefined> {
		const result = await sanitizedExec(executable(REAL_GIT_CANDIDATES, "Git"), [...SAFE_GIT_ARGS, "-C", cwd, ...args], 30_000, signal)
		if (result.killed) throw new Error(`git ${args[0]} timed out`)
		if (result.code === 1) return undefined
		if (result.code !== 0) {
			throw new Error(escapeControlCharacters((result.stderr || result.stdout).trim()) || `git ${args[0]} failed`)
		}
		return stripFinalLineEnding(result.stdout)
	}

	async function gh(args: string[], signal?: AbortSignal): Promise<string> {
		const result = await sanitizedExec(executable(REAL_GH_CANDIDATES, "GitHub CLI"), args, 120_000, signal)
		if (result.killed) throw new Error("gh timed out")
		if (result.code !== 0) throw new Error(escapeControlCharacters((result.stderr || result.stdout).trim()) || "gh failed")
		return stripFinalLineEnding(result.stdout)
	}

	async function remoteHead(repo: string, pushUrl: string, branch: string, signal?: AbortSignal): Promise<string | undefined> {
		const ref = `refs/heads/${branch}`
		const output = await git(repo, ["ls-remote", "--heads", "--refs", pushUrl, ref], 30_000, signal)
		if (!output) return undefined
		const [commit, foundRef, extra] = output.split(/\s+/)
		if (extra || foundRef !== ref || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Remote branch lookup returned an invalid result")
		return commit
	}

	async function resolveTarget(repo: string, branch: string, signal?: AbortSignal) {
		const remotes = (await git(repo, ["remote"], 30_000, signal)).split("\n").filter(Boolean)
		const remote = await optionalGit(repo, ["config", "--get", `branch.${branch}.remote`], signal)
		const mergeRef = await optionalGit(repo, ["config", "--get", `branch.${branch}.merge`], signal)
		const configured = remote && mergeRef ? configuredPushTarget(remote, mergeRef, remotes) : undefined
		if ((remote || mergeRef) && !configured) throw new Error("The configured upstream is incomplete or unsupported")
		const target = configured ?? defaultPushTarget(branch, remotes)
		if (!target) throw new Error("Configure an upstream or keep exactly one remote (preferably origin)")
		await git(repo, ["check-ref-format", "--branch", target.branch], 30_000, signal)
		if ((await optionalGit(repo, ["config", "--bool", "--get", `remote.${target.remote}.mirror`], signal)) === "true") {
			throw new Error(`Mirror remote ${target.remote} is not supported`)
		}
		const pushUrls = (await git(repo, ["remote", "get-url", "--push", "--all", target.remote], 30_000, signal))
			.split("\n")
			.filter(Boolean)
		if (pushUrls.length !== 1) throw new Error(`${target.remote} must have exactly one push URL`)
		if (!isSupportedSshPushUrl(pushUrls[0])) throw new Error(`Only SSH push URLs are supported: ${escapeControlCharacters(pushUrls[0])}`)
		const trackingRef = configured
			? await git(repo, ["rev-parse", "--symbolic-full-name", "@{upstream}"], 30_000, signal)
			: `refs/remotes/${target.remote}/${target.branch}`
		if (!trackingRef.startsWith("refs/remotes/")) throw new Error(`Unsupported tracking ref: ${escapeControlCharacters(trackingRef)}`)
		return {
			...target,
			configured: Boolean(configured),
			pushUrl: pushUrls[0],
			trackingRef,
			localTrackingCommit: await optionalGit(repo, ["show-ref", "--verify", "--hash", trackingRef], signal),
			remoteCommit: await remoteHead(repo, pushUrls[0], target.branch, signal),
		}
	}

	async function currentRepository(cwd: string, signal?: AbortSignal) {
		const repo = await git(cwd, ["rev-parse", "--show-toplevel"], 30_000, signal)
		if (await git(repo, ["status", "--porcelain", "--untracked-files=all"], 30_000, signal)) {
			throw new Error("Commit or discard local changes before publishing")
		}
		const branch = await git(repo, ["branch", "--show-current"], 30_000, signal)
		if (!branch) throw new Error("Cannot publish from detached HEAD")
		return { repo, branch, commit: await git(repo, ["rev-parse", "HEAD"], 30_000, signal) }
	}

	async function githubContext(cwd: string, signal?: AbortSignal) {
		const repo = await git(cwd, ["rev-parse", "--show-toplevel"], 30_000, signal)
		const branch = await git(repo, ["branch", "--show-current"], 30_000, signal)
		const remotes = (await git(repo, ["remote"], 30_000, signal)).split("\n").filter(Boolean)
		const configuredRemote = branch ? await optionalGit(repo, ["config", "--get", `branch.${branch}.remote`], signal) : undefined
		const mergeRef = branch ? await optionalGit(repo, ["config", "--get", `branch.${branch}.merge`], signal) : undefined
		const target = configuredRemote && mergeRef ? configuredPushTarget(configuredRemote, mergeRef, remotes) : undefined
		if ((configuredRemote || mergeRef) && !target) throw new Error("The configured upstream is incomplete or unsupported")
		const remote = target?.remote ?? (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined)
		if (!remote) throw new Error("Configure an upstream or keep exactly one remote (preferably origin)")
		const urls = (await git(repo, ["remote", "get-url", "--push", "--all", remote], 30_000, signal)).split("\n").filter(Boolean)
		const repository = urls.length === 1 ? githubRepository(urls[0]) : undefined
		if (!repository) throw new Error("GitHub pull request operations support one github.com SSH remote only")
		return { branch: target?.branch ?? branch, repository }
	}

	function selectedGithubRepository(value: string | undefined, fallback: string): string {
		const repository = value ?? fallback
		if (!(new RegExp(GITHUB_REPOSITORY_PATTERN).test(repository))) throw new Error("Use a github.com/owner/repository name")
		return repository
	}

	const sameRepository = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

	async function pullRequestNumber(repository: string, branch: string, headRepository: string, number: number | undefined, signal?: AbortSignal): Promise<string> {
		if (number) return String(number)
		if (!branch) throw new Error("Specify a pull request number from detached HEAD")
		const candidates = JSON.parse(await gh([
			"pr", "list", "--repo", repository, "--state", "open", "--head", branch, "--limit", "1000",
			"--json", "number,headRefName,headRepository",
		], signal)) as Array<{ number: number; headRefName: string; headRepository?: { nameWithOwner?: string } }>
		const matches = candidates.filter((pullRequest) => pullRequest.headRefName === branch && pullRequest.headRepository?.nameWithOwner && sameRepository(pullRequest.headRepository.nameWithOwner, headRepository))
		if (matches.length !== 1) throw new Error(matches.length ? "Multiple pull requests use the current branch; specify a number" : "No open pull request uses the current branch")
		return String(matches[0].number)
	}

	async function toolOutput(value: string): Promise<{ text: string; file?: string }> {
		const escaped = escapeControlCharacters(value)
		const truncated = truncateTail(escaped, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
		if (!truncated.truncated) return { text: truncated.content }
		const directory = await mkdtemp(join(tmpdir(), "pi-github-"))
		const file = join(directory, `${Date.now()}-${randomUUID()}.txt`)
		await writeFile(file, value, { encoding: "utf8", mode: 0o600 })
		return {
			text: `${truncated.content}\n\n[Output truncated: ${truncated.outputLines}/${truncated.totalLines} lines, ${formatSize(truncated.outputBytes)}/${formatSize(truncated.totalBytes)}. Full output: ${file}]`,
			file,
		}
	}

	pi.registerTool({
		name: "push_current_branch",
		label: "Push Current Branch",
		description: "Confirm and push the current commit to its upstream, or to the same branch on origin when no upstream exists. Use only after the user explicitly asks to push.",
		promptGuidelines: ["Call push_current_branch only after an explicit user request to push and the required closeout checks."],
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("Push requires interactive confirmation")
			const { repo, branch, commit } = await currentRepository(ctx.cwd, signal)
			let target = await resolveTarget(repo, branch, signal)
			if (target.remoteCommit) {
				await git(repo, ["fetch", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", target.pushUrl, `refs/heads/${target.branch}`], 120_000, signal)
				target = await resolveTarget(repo, branch, signal)
			}
			const [behind, ahead] = target.remoteCommit
				? (await git(repo, ["rev-list", "--left-right", "--count", `${target.remoteCommit}...${commit}`], 30_000, signal)).split(/\s+/).map(Number)
				: [0, Number(await git(repo, ["rev-list", "--count", commit], 30_000, signal))]
			if (behind) throw new Error(`Current branch is ${behind} commit(s) behind ${target.remote}/${target.branch}; update it before pushing`)
			if (!ahead) return { content: [{ type: "text" as const, text: "No commits to push" }], details: {} }
			const commits = (await git(repo, ["log", "--oneline", "--max-count=10", ...(target.remoteCommit ? [`${target.remoteCommit}..${commit}`] : [commit])], 30_000, signal))
				.split("\n")
				.map(escapeControlCharacters)
				.join("\n")
			if (!(await ctx.ui.confirm(
				"Push current branch?",
				`${escapeControlCharacters(repo)}\n${escapeControlCharacters(branch)} → ${escapeControlCharacters(target.remote)}/${escapeControlCharacters(target.branch)}\n${escapeControlCharacters(target.pushUrl)}\n${ahead} outgoing commit(s):\n\n${commits}`,
			))) return { content: [{ type: "text" as const, text: "Push cancelled" }], details: {} }
			if (ahead > 10 && !(await ctx.ui.confirm("Push all outgoing commits?", `Only the newest 10 of ${ahead} commits were shown. Push all ${ahead}?`))) {
				return { content: [{ type: "text" as const, text: "Push cancelled" }], details: {} }
			}
			const confirmedRepository = await currentRepository(repo, signal)
			const confirmedTarget = await resolveTarget(repo, branch, signal)
			if (confirmedRepository.branch !== branch || confirmedRepository.commit !== commit || JSON.stringify(confirmedTarget) !== JSON.stringify(target)) {
				throw new Error("Repository or push target changed after confirmation; try again")
			}
			const literalPushUrl = `agent-toolkit-push-${randomUUID()}://confirmed`
			const output = await git(repo, [
				"-c", "push.followTags=false",
				"-c", "push.recurseSubmodules=no",
				"-c", `url.${target.pushUrl}.insteadOf=${literalPushUrl}`,
				"-c", `url.${target.pushUrl}.pushInsteadOf=${literalPushUrl}`,
				"push", "--porcelain", "--no-signed", `--force-with-lease=refs/heads/${target.branch}:${target.remoteCommit ?? ""}`, "--recurse-submodules=no", "--receive-pack=git-receive-pack",
				literalPushUrl, `${commit}:refs/heads/${target.branch}`,
			], 120_000, signal)
			let text = escapeControlCharacters(output) || `Pushed ${commit.slice(0, 12)} to ${target.remote}/${target.branch}`
			try {
				await git(repo, ["update-ref", target.trackingRef, commit, target.localTrackingCommit ?? "0".repeat(commit.length)], 30_000, signal)
				if (!target.configured) await git(repo, ["branch", "--set-upstream-to", `${target.remote}/${target.branch}`, branch], 30_000, signal)
			} catch (error) {
				text += `\nPush succeeded, but the local upstream was not updated: ${escapeControlCharacters(error instanceof Error ? error.message : String(error))}`
			}
			return { content: [{ type: "text" as const, text }], details: { commit, upstream: `${target.remote}/${target.branch}` } }
		},
	})

	pi.registerTool({
		name: "create_pull_request",
		label: "Create Pull Request",
		description: "Confirm and create a GitHub pull request for the pushed current branch. Read and fill the repository's applicable pull request template before calling this tool.",
		promptGuidelines: ["Call create_pull_request only after an explicit user request. Read the applicable repository pull request template and pass its completed content as body."],
		parameters: Type.Object({
			repository: Type.Optional(Type.String({ pattern: GITHUB_REPOSITORY_PATTERN, description: "Base repository as github.com/owner/repository. Omit when the push remote is also the base repository." })),
			base: Type.String({ minLength: 1, maxLength: 255, description: "Target branch" }),
			title: Type.String({ minLength: 1, maxLength: 256 }),
			body: Type.String({ minLength: 1, maxLength: 65_536, description: "Completed pull request template" }),
			draft: Type.Optional(Type.Boolean()),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("Pull request creation requires interactive confirmation")
			const { repo, branch, commit } = await currentRepository(ctx.cwd, signal)
			await git(repo, ["check-ref-format", "--branch", params.base], 30_000, signal)
			const target = await resolveTarget(repo, branch, signal)
			if (target.remoteCommit !== commit) throw new Error("Push the current commit before creating the pull request")
			const pushRepository = githubRepository(target.pushUrl)
			if (!pushRepository) throw new Error("Pull request creation supports github.com SSH remotes only")
			const repository = selectedGithubRepository(params.repository, pushRepository)
			if (sameRepository(repository, pushRepository) && params.base === target.branch) throw new Error("The pull request base and head branches must differ")
			const owner = pushRepository.split("/")[1]
			const candidates = JSON.parse(await gh(["pr", "list", "--repo", repository, "--state", "open", "--base", params.base, "--head", target.branch, "--limit", "1000", "--json", "number,url,baseRefName,headRefName,headRepository"], signal)) as Array<{ number: number; url: string; baseRefName: string; headRefName: string; headRepository?: { nameWithOwner?: string } }>
			const existing = candidates.find((pullRequest) => pullRequest.baseRefName === params.base && pullRequest.headRefName === target.branch && pullRequest.headRepository?.nameWithOwner && sameRepository(pullRequest.headRepository.nameWithOwner, pushRepository.slice("github.com/".length)))
			if (existing) return { content: [{ type: "text" as const, text: `Pull request already exists: ${escapeControlCharacters(existing.url)}` }], details: existing }
			if (!(await ctx.ui.confirm(
				"Create pull request?",
				`${pushRepository}:${target.branch} → ${repository}:${params.base}\n${params.draft ? "Draft: yes" : "Draft: no"}\n\n${escapeControlCharacters(params.title)}\n\n${escapeControlCharacters(params.body)}`,
			))) return { content: [{ type: "text" as const, text: "Pull request creation cancelled" }], details: {} }
			const confirmedRepository = await currentRepository(repo, signal)
			const confirmedTarget = await resolveTarget(repo, branch, signal)
			if (confirmedRepository.branch !== branch || confirmedRepository.commit !== commit || JSON.stringify(confirmedTarget) !== JSON.stringify(target)) {
				throw new Error("Repository or remote branch changed after confirmation; try again")
			}
			const head = sameRepository(repository, pushRepository) ? target.branch : `${owner}:${target.branch}`
			const args = [
				"api", "--hostname", "github.com", `repos/${repository.slice("github.com/".length)}/pulls`, "--method", "POST", "--jq", ".html_url",
				"--raw-field", `base=${params.base}`, "--raw-field", `head=${head}`,
				"--raw-field", `title=${params.title}`, "--raw-field", `body=${params.body}`,
			]
			if (!sameRepository(repository, pushRepository)) args.push("--raw-field", `head_repo=${pushRepository.split("/").at(-1)}`)
			if (params.draft) args.push("--field", "draft=true")
			const output = await gh(args, signal)
			return { content: [{ type: "text" as const, text: escapeControlCharacters(output) }], details: { repository, base: params.base, head: target.branch } }
		},
	})

	pi.registerTool({
		name: "inspect_pull_request",
		label: "Inspect Pull Request",
		description: "Inspect a GitHub pull request, its reviews, and its CI checks through the GitHub CLI. Optionally include failed GitHub Actions logs. Use this instead of a browser.",
		promptGuidelines: ["Use inspect_pull_request, not a browser, for GitHub pull request status, comments, reviews, CI failures, and failed Actions logs."],
		parameters: Type.Object({
			repository: Type.Optional(Type.String({ pattern: GITHUB_REPOSITORY_PATTERN, description: "Pull request repository as github.com/owner/repository. Omit when it matches the push remote." })),
			number: Type.Optional(Type.Integer({ minimum: 1, description: "Pull request number. Omit for the current branch." })),
			includeFailedLogs: Type.Optional(Type.Boolean()),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { branch, repository: pushRepository } = await githubContext(ctx.cwd, signal)
			const repository = selectedGithubRepository(params.repository, pushRepository)
			const number = await pullRequestNumber(repository, branch, pushRepository.slice("github.com/".length), params.number, signal)
			const pullRequest = JSON.parse(await gh([
				"pr", "view", number, "--repo", repository, "--json",
				"number,url,title,state,isDraft,baseRefName,headRefName,body,reviewDecision,mergeStateStatus,statusCheckRollup,comments,reviews",
			], signal))
			const reviewCommentPages = JSON.parse(await gh([
				"api", "--hostname", "github.com", `repos/${repository.slice("github.com/".length)}/pulls/${number}/comments?per_page=100`, "--paginate", "--slurp",
			], signal)) as unknown[][]
			const reviewComments = reviewCommentPages.flat()
			let output = JSON.stringify({ ...pullRequest, reviewComments }, null, 2)
			const runs: Record<string, string> = {}
			if (params.includeFailedLogs) {
				const ids = new Set<string>()
				for (const check of Array.isArray(pullRequest.statusCheckRollup) ? pullRequest.statusCheckRollup : []) {
					const outcome = String(check?.conclusion ?? check?.state ?? check?.bucket ?? "").toUpperCase()
					if (!["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "FAIL"].includes(outcome) || typeof check?.detailsUrl !== "string") continue
					try {
						const url = new URL(check.detailsUrl)
						const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/)
						if (url.hostname === "github.com" && match?.[1] && sameRepository(match[1], repository.slice("github.com/".length))) ids.add(match[2])
					} catch {}
					if (ids.size === 10) break
				}
				for (const id of ids) {
					try {
						runs[id] = await gh(["run", "view", id, "--repo", repository, "--log-failed"], signal)
					} catch (error) {
						runs[id] = error instanceof Error ? error.message : String(error)
					}
					output += `\n\n## Failed logs for Actions run ${id}\n\n${runs[id]}`
				}
			}
			const rendered = await toolOutput(output)
			return {
				content: [{ type: "text" as const, text: rendered.text }],
				details: { number: pullRequest.number, url: pullRequest.url, reviewCommentCount: reviewComments.length, runIds: Object.keys(runs), file: rendered.file },
			}
		},
	})

	pi.registerTool({
		name: "comment_on_pull_request",
		label: "Comment On Pull Request",
		description: "Confirm and add a comment to a GitHub pull request through the GitHub CLI. Use only after the user explicitly asks to comment.",
		promptGuidelines: ["Call comment_on_pull_request only after an explicit user request to publish a pull request comment. Do not use a browser."],
		parameters: Type.Object({
			repository: Type.Optional(Type.String({ pattern: GITHUB_REPOSITORY_PATTERN, description: "Pull request repository as github.com/owner/repository. Omit when it matches the push remote." })),
			number: Type.Optional(Type.Integer({ minimum: 1, description: "Pull request number. Omit for the current branch." })),
			body: Type.String({ minLength: 1, maxLength: 65_536 }),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("Pull request comments require interactive confirmation")
			const { branch, repository: pushRepository } = await githubContext(ctx.cwd, signal)
			const repository = selectedGithubRepository(params.repository, pushRepository)
			const number = await pullRequestNumber(repository, branch, pushRepository.slice("github.com/".length), params.number, signal)
			const pullRequest = JSON.parse(await gh(["pr", "view", number, "--repo", repository, "--json", "number,url,state"], signal)) as { number: number; url: string; state: string }
			if (!(await ctx.ui.confirm(
				"Comment on pull request?",
				`${escapeControlCharacters(pullRequest.url)}\n\n${escapeControlCharacters(params.body)}`,
			))) return { content: [{ type: "text" as const, text: "Pull request comment cancelled" }], details: {} }
			const output = await gh(["pr", "comment", String(pullRequest.number), "--repo", repository, "--body", params.body], signal)
			return { content: [{ type: "text" as const, text: escapeControlCharacters(output) }], details: { number: pullRequest.number, repository } }
		},
	})

	for (const [name, description, prompt] of [
		["push", "Run required closeout, then confirm and push the current branch", PUSH_PROMPT],
		["pr", "Draft a repository-template pull request, then confirm and create it", PR_PROMPT],
	] as const) {
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				if (args.trim()) return ctx.ui.notify(`/${name} accepts no arguments`, "error")
				await ctx.waitForIdle()
				pi.sendUserMessage(prompt)
			},
		})
	}
}
