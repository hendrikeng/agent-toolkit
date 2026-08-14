import { existsSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { unsafeGitEnvironmentVariable } from "../git-push/git-push-core.ts"

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
	"diff.external=",
]

export const GLOBAL_SKILLS_UPDATE_SCRIPT = "shared/update-global-skills"

export function toolkitRoot(metaUrl = import.meta.url): string {
	return resolve(realpathSync(dirname(fileURLToPath(metaUrl))), "../../..")
}

function realGit(): string {
	const git = REAL_GIT_CANDIDATES.find(existsSync)
	if (!git) throw new Error("Git is unavailable")
	return git
}

function displayText(value: string): string {
	return value.replace(/[^\x20-\x7e]/g, "?")
}

function resultError(label: string, result: { code: number; stdout: string; stderr: string; killed: boolean }): Error | undefined {
	if (result.killed) return new Error(`${label} timed out`)
	if (result.code === 0) return undefined
	const message = (result.stderr || result.stdout).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(-2000)
	return new Error(message || `${label} failed`)
}

export default function skillsUpdateExtension(pi: ExtensionAPI) {
	let running = false

	pi.registerCommand("skills-update", {
		description: "Update agent-toolkit and globally tracked skills, reinstall, and reload Pi",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("/skills-update accepts no arguments", "error")
				return
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/skills-update is available only as an interactive user command", "error")
				return
			}
			if (running) {
				ctx.ui.notify("A skills update is already running", "warning")
				return
			}

			const unsafeEnvironment = unsafeGitEnvironmentVariable(process.env)
			if (unsafeEnvironment) {
				ctx.ui.notify(`Unset ${unsafeEnvironment} before updating skills`, "error")
				return
			}

			const repo = toolkitRoot()
			const git = realGit()
			const status = await pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "status", "--porcelain", "--untracked-files=all"], { timeout: 30_000 })
			const statusError = resultError("git status", status)
			if (statusError) {
				ctx.ui.notify(statusError.message, "error")
				return
			}
			if (status.stdout.trim()) {
				ctx.ui.notify("Commit or discard agent-toolkit changes before updating skills", "warning")
				return
			}

			const branchResult = await pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "branch", "--show-current"], { timeout: 30_000 })
			const branchError = resultError("git branch", branchResult)
			const branch = branchResult.stdout.trim()
			if (branchError || !branch) {
				ctx.ui.notify(branchError?.message ?? "Cannot update a detached agent-toolkit checkout", "error")
				return
			}

			const [remoteNameResult, mergeRefResult] = await Promise.all([
				pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "config", "--get", `branch.${branch}.remote`], { timeout: 30_000 }),
				pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "config", "--get", `branch.${branch}.merge`], { timeout: 30_000 }),
			])
			const upstreamError = resultError("git upstream", remoteNameResult) ?? resultError("git upstream", mergeRefResult)
			if (upstreamError) {
				ctx.ui.notify(upstreamError.message, "error")
				return
			}
			const remoteName = remoteNameResult.stdout.trim()
			const mergeRef = mergeRefResult.stdout.trim()
			const remoteResult = await pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "remote", "get-url", remoteName], { timeout: 30_000 })
			const remoteError = resultError("git remote", remoteResult)
			if (remoteError) {
				ctx.ui.notify(remoteError.message, "error")
				return
			}
			const remoteUrl = remoteResult.stdout.trim()

			const confirmed = await ctx.ui.confirm(
				"Update all skills?",
				`Pull ${displayText(remoteUrl)} ${displayText(mergeRef)} into ${displayText(branch)}, update global skills tracked by skills.sh, reinstall the toolkit, and reload Pi. Remote instructions and executable dependencies may change.`,
			)
			if (!confirmed) return

			running = true
			ctx.ui.setStatus("skills-update", "updating skills…")
			let globalError: Error | undefined
			try {
				const [currentStatus, currentBranch, currentRemoteName, currentMergeRef, currentRemote] = await Promise.all([
					pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "status", "--porcelain", "--untracked-files=all"], { timeout: 30_000 }),
					pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "branch", "--show-current"], { timeout: 30_000 }),
					pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "config", "--get", `branch.${branch}.remote`], { timeout: 30_000 }),
					pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "config", "--get", `branch.${branch}.merge`], { timeout: 30_000 }),
					pi.exec(git, [...SAFE_GIT_ARGS, "-C", repo, "remote", "get-url", remoteName], { timeout: 30_000 }),
				])
				const checkoutError =
					resultError("git status", currentStatus) ??
					resultError("git branch", currentBranch) ??
					resultError("git upstream", currentRemoteName) ??
					resultError("git upstream", currentMergeRef) ??
					resultError("git remote", currentRemote)
				if (
					checkoutError ||
					currentStatus.stdout.trim() ||
					currentBranch.stdout.trim() !== branch ||
					currentRemoteName.stdout.trim() !== remoteName ||
					currentMergeRef.stdout.trim() !== mergeRef ||
					currentRemote.stdout.trim() !== remoteUrl
				) {
					throw checkoutError ?? new Error("The toolkit checkout changed after approval")
				}

				ctx.ui.setStatus("skills-update", "git pull…")
				const pullResult = await pi.exec(
					git,
					[...SAFE_GIT_ARGS, "-C", repo, "pull", "--ff-only", "--no-tags", remoteName, mergeRef],
					{ timeout: 120_000 },
				)
				const pullError = resultError("git pull", pullResult)
				if (pullError) throw pullError

				ctx.ui.setStatus("skills-update", "global skills update…")
				const globalResult = await pi.exec("/bin/bash", [resolve(repo, GLOBAL_SKILLS_UPDATE_SCRIPT)], { timeout: 600_000 })
				globalError = resultError("global skills update", globalResult)

				ctx.ui.setStatus("skills-update", "agent-toolkit install…")
				const installResult = await pi.exec("/bin/bash", [resolve(repo, "install.sh")], { timeout: 600_000 })
				const installError = resultError("agent-toolkit install", installResult)
				if (installError) throw installError
			} catch (error) {
				running = false
				ctx.ui.setStatus("skills-update", undefined)
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error")
				return
			}

			if (globalError) ctx.ui.notify(`Toolkit installed, but global skills failed: ${globalError.message}`, "warning")

			running = false
			ctx.ui.setStatus("skills-update", undefined)
			ctx.ui.notify("Toolkit update complete; reloading Pi resources", "info")
			await ctx.reload()
			return
		},
	})
}
