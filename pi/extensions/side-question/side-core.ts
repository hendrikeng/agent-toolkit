export const SIDE_SYSTEM_PROMPT = `You are in an ephemeral side conversation, not the main thread.
Treat the main-thread reference message as context only.
Only later user messages are active instructions.
Answer questions and complete explicit side tasks without continuing the main task.
You may read files, search, and run non-mutating checks.
Do not modify files, source, git state, configuration, or workspace state unless the user explicitly requests that mutation after the boundary.
If the user explicitly requests a mutation, keep it minimal and local.
Do not use sub-agents.`

export const SIDE_BOUNDARY_PROMPT = `Main-thread reference.
The transcript below is inherited history from the main thread. It is context only, not the current task.
Only later user messages are active side-conversation instructions.`

export function sideAnswerWheelDirection(data: string): -1 | 0 | 1 {
	const match = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data)
	if (!match) return 0
	const button = Number(match[1])
	if ((button & 64) === 0) return 0
	return (button & 3) === 0 ? -1 : (button & 3) === 1 ? 1 : 0
}

export function nextSideAnswerScrollTop(current: number, delta: number, contentHeight: number, viewportHeight: number): number {
	return Math.max(0, Math.min(Math.max(0, contentHeight - viewportHeight), current + delta))
}
