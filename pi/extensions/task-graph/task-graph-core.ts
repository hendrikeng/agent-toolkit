export const TASK_GRAPH_USAGE = "Usage: /graph <objective>"

export function taskGraphPrompt(objective: string): string {
	return `Coordinate this objective with a task graph:

${objective}

First inspect the repository and the real execution path. Then decide whether parallel workers provide a clear benefit. If the work is small or tightly coupled, explain that decision and complete it directly without creating a graph.

If a graph helps, propose a DAG of two to six bounded tasks. For each task, show its id, goal, dependencies, owned files or areas, specialty, and completion criteria. Keep dependency chains at most four tasks deep. Reject cycles, unclear completion criteria, and overlapping write ownership. Include integration and focused validation work in the graph when they are necessary.

Ask for approval of the proposed graph before dispatch. Use ask_user_question when it is available. After approval, run \`orca skills get orchestration\` and follow that version-matched guide. Confirm Orca is ready. Create or bind one Run, create the tasks with their dependencies, and start every ready independent worker before waiting. Use Orca for task state, dispatch, worker lifecycle, and messages. Do not recreate those features in Pi or in project files.

Specialize workers through their task briefs and tools instead of permanent role classes. Keep work in the current worktree unless the user requested another worktree or a concrete file conflict requires isolation. Supervise until every dispatch settles. Release completed workers, integrate the results, and run the smallest focused checks. Replan only a failed or blocked task, and allow at most one replacement attempt unless the user approves more.`
}
