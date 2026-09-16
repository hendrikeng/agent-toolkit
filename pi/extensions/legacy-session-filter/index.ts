import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function legacySessionFilter(pi: ExtensionAPI): void {
	pi.on("context", async (event) => {
		const messages = event.messages.filter(
			(message) => (message as { customType?: string }).customType !== "codex-goal-continuation",
		);
		return messages.length === event.messages.length ? undefined : { messages };
	});
}
