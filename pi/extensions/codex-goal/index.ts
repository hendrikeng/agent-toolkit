import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETIRED_GOAL_MESSAGE = "codex-goal-continuation";

export default function retiredGoalCompatibility(pi: ExtensionAPI): void {
	pi.on("context", async (event) => {
		const messages = event.messages.filter(
			(message) => (message as { customType?: string }).customType !== RETIRED_GOAL_MESSAGE,
		);
		return messages.length === event.messages.length ? undefined : { messages };
	});
}
