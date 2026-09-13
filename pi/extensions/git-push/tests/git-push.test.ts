import assert from "node:assert/strict"
import test from "node:test"
import {
	configuredPushTarget,
	defaultPushTarget,
	escapeControlCharacters,
	githubRepository,
	isSupportedSshPushUrl,
	stripFinalLineEnding,
	unsafeGitEnvironmentVariable,
} from "../git-push-core.ts"

test("accepts only a configured remote branch target", () => {
	assert.deepEqual(configuredPushTarget("origin", "refs/heads/main", ["origin"]), {
		remote: "origin",
		branch: "main",
	})
	assert.deepEqual(configuredPushTarget("team", "refs/heads/origin/main", ["team", "team/origin"]), {
		remote: "team",
		branch: "origin/main",
	})
	assert.equal(configuredPushTarget("missing", "refs/heads/main", ["origin"]), undefined)
	assert.equal(configuredPushTarget("origin", "refs/tags/v1", ["origin"]), undefined)
})

test("uses origin or the only remote for a branch without an upstream", () => {
	assert.deepEqual(defaultPushTarget("release/1", ["upstream", "origin"]), { remote: "origin", branch: "release/1" })
	assert.deepEqual(defaultPushTarget("fix/1", ["team"]), { remote: "team", branch: "fix/1" })
	assert.equal(defaultPushTarget("fix/1", ["team", "fork"]), undefined)
})

test("extracts only github.com repositories from SSH URLs", () => {
	assert.equal(githubRepository("git@github.com:owner/repo.git"), "github.com/owner/repo")
	assert.equal(githubRepository("ssh://git@github.com/owner/repo.git"), "github.com/owner/repo")
	assert.equal(githubRepository("git@example.com:owner/repo.git"), undefined)
	assert.equal(githubRepository("https://github.com/owner/repo.git"), undefined)
})

test("removes only Git's final record newline", () => {
	assert.equal(stripFinalLineEnding(" value \n"), " value ")
	assert.equal(stripFinalLineEnding("value\r\n"), "value")
})

test("renders terminal and Unicode formatting controls visibly", () => {
	assert.equal(escapeControlCharacters("safe\u001b[2J\nnext\u202ereversed"), "safe\\x1b[2J\\x0anext\\u{202e}reversed")
})

test("allows only built-in SSH push transports", () => {
	assert.equal(isSupportedSshPushUrl("git@github.com:owner/repo.git"), true)
	assert.equal(isSupportedSshPushUrl("github.com:owner/repo.git"), true)
	assert.equal(isSupportedSshPushUrl("ssh://git@github.com/owner/repo.git"), true)
	assert.equal(isSupportedSshPushUrl("https://github.com/owner/repo.git"), false)
	assert.equal(isSupportedSshPushUrl("ext::command"), false)
	assert.equal(isSupportedSshPushUrl("helper::destination"), false)
	assert.equal(isSupportedSshPushUrl("git@github.com:owner/bad repo.git"), false)
	assert.equal(isSupportedSshPushUrl("ssh://github.com/owner/repo=name.git"), false)
	assert.equal(isSupportedSshPushUrl("/tmp/repo.git"), false)
})

test("rejects inherited executable Git configuration", () => {
	assert.equal(unsafeGitEnvironmentVariable({ PATH: "/usr/bin" }), undefined)
	assert.equal(unsafeGitEnvironmentVariable({ GIT_SSH_COMMAND: "wrapper" }), "GIT_SSH_COMMAND")
	assert.equal(unsafeGitEnvironmentVariable({ GIT_CONFIG_KEY_0: "core.sshCommand" }), "GIT_CONFIG_KEY_0")
	assert.equal(unsafeGitEnvironmentVariable({ GIT_DIR: "/tmp/other.git" }), "GIT_DIR")
})
