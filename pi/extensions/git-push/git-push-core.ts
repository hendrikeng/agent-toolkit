export function stripFinalLineEnding(value: string): string {
	return value.endsWith("\r\n") ? value.slice(0, -2) : value.endsWith("\n") ? value.slice(0, -1) : value
}

export function escapeControlCharacters(value: string): string {
	return value.replace(/[\x00-\x1f\x7f-\x9f]|\p{Cf}/gu, (character) => {
		const codePoint = character.codePointAt(0)!
		return codePoint <= 0xff ? `\\x${codePoint.toString(16).padStart(2, "0")}` : `\\u{${codePoint.toString(16)}}`
	})
}

const EXECUTABLE_GIT_ENV = new Set([
	"GIT_ASKPASS",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_EXEC_PATH",
	"GIT_PROXY_COMMAND",
	"GIT_SSH",
	"GIT_SSH_COMMAND",
	"SSH_ASKPASS",
])

export function unsafeGitEnvironmentVariable(env: NodeJS.ProcessEnv): string | undefined {
	return Object.keys(env).find(
		(key) =>
			env[key] !== undefined &&
			(EXECUTABLE_GIT_ENV.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)),
	)
}

export function isSupportedSshPushUrl(value: string): boolean {
	if (/[\s\x00-\x1f\x7f-\x9f=]/.test(value)) return false
	if (/^ssh:\/\//i.test(value)) return true
	if (value.includes("://")) return false
	return /^(?:[^\s/@:]+@)?[^\s/:]+:(?!:).+/.test(value)
}

export function configuredPushTarget(
	remote: string,
	mergeRef: string,
	remotes: readonly string[],
): { remote: string; branch: string } | undefined {
	if (!remotes.includes(remote) || !mergeRef.startsWith("refs/heads/")) return undefined
	const branch = mergeRef.slice("refs/heads/".length)
	return branch ? { remote, branch } : undefined
}
