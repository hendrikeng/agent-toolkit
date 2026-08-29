import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

function configPath(): string {
	return join(process.env.AGENT_TOOLKIT_PI_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "codex-fast.json")
}

export function readFastMode(path = configPath()): boolean {
	try {
		return JSON.parse(readFileSync(path, "utf8")).enabled === true
	} catch {
		return false
	}
}

export function writeFastMode(enabled: boolean, path = configPath()): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
	const temporary = `${path}.${process.pid}.tmp`
	try {
		writeFileSync(temporary, `${JSON.stringify({ enabled }, null, 2)}\n`, { flag: "wx", mode: 0o600 })
		renameSync(temporary, path)
	} finally {
		rmSync(temporary, { force: true })
	}
}

export function supportsFastMode(model: unknown): model is string {
	return model === "gpt-5.4" || model === "gpt-5.5" || (typeof model === "string" && model.startsWith("gpt-5.6-"))
}

export function fastModeCostMultiplier(model: string): number {
	return model === "gpt-5.4" ? 2 : 2.5
}

export function applyFastMode(provider: string | undefined, enabled: boolean, payload: unknown): void {
	if (provider !== "openai-codex" || !enabled || !payload || typeof payload !== "object") return
	const body = payload as Record<string, unknown>
	if (supportsFastMode(body.model)) body.service_tier = "priority"
}
