import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function permissionFloor(pi: ExtensionAPI): void {
	pi.on("project_trust", async (event, ctx) => {
		if (!process.env.AGENT_TOOLKIT_PI_AGENT_DIR) return { trusted: "undecided" };
		const override = [
			join(event.cwd, ".pi/extensions/pi-permission-system/config.json"),
			join(event.cwd, ".pi/agent/pi-permissions.jsonc"),
			join(event.cwd, ".pi/agents"),
		].find((path) => {
			try { lstatSync(path); return true; }
			catch (error) { return !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""); }
		});
		if (!override) return { trusted: "undecided" };
		ctx.ui.notify(`Project trust refused because ${override} can override the global permission policy.`, "warning");
		return { trusted: "no" };
	});
}
