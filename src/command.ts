import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { configPath } from "./config.js";
import { DB_FILENAME } from "./store.js";
import { RouterController } from "./controller.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const VERBS = ["on", "off", "status", "next", "config"] as const;
const EXAMPLE_BODY = "{\"chain\":[\"provider/model-id\",\"provider/fallback-model-id\"]} (see pi-model-router.example.json)";
const HELP = [
  "/model-router on — arm routing and switch onto the chain",
  "/model-router off — disarm routing",
  "/model-router status — chain order, cooldowns, today's limit counts",
  "/model-router next — advance to the next eligible model",
  "/model-router config — the configured chain and where the files live",
].join("\n");

type NotifyType = "info" | "warning" | "error";

/** Printed under every listing so the files are one click away, not a README lookup. */
function paths(): string {
  const agentDir = getAgentDir();
  return [
    `config:  ${configPath(agentDir)}`,
    `history: ${join(agentDir, DB_FILENAME)}`,
  ].join("\n");
}

export function registerModelRouterCommand(
  pi: ExtensionAPI,
  controller: () => RouterController | undefined,
  notify: (message: string, type: NotifyType) => void,
): void {
  pi.registerCommand("model-router", {
    description: "Model-router fallback routing: on | off | status | next | config",
    getArgumentCompletions: (prefix): AutocompleteItem[] | null => {
      const hits = VERBS
        .filter((verb) => verb.startsWith(prefix))
        .map((verb) => ({ value: verb, label: verb }));
      return hits.length ? hits : null;
    },
    handler: async (args, ctx) => {
      const verb = args.trim();
      const instance = controller();
      if (!instance) {
        notify(
          `Create ${configPath(getAgentDir())} with ${EXAMPLE_BODY}`,
          "warning",
        );
        return;
      }

      if (verb === "") {
        notify(`${instance.active ? "armed" : "off"}\n${HELP}\n\n${paths()}`, "info");
        return;
      }
      if (verb === "off") {
        instance.deactivate();
        return;
      }
      if (verb === "on" || verb === "next") {
        if (!ctx.isIdle()) {
          notify("wait for the current run to settle", "warning");
          return;
        }
        if (verb === "on") {
          await instance.activate();
        } else {
          await instance.advance("manual");
        }
        return;
      }
      if (verb === "status") {
        notify(`${instance.statusText()}\n\n${paths()}`, "info");
        return;
      }
      if (verb === "config") {
        notify(`${instance.configText()}\n\n${paths()}`, "info");
        return;
      }

      notify("Usage: /model-router [on|off|status|next|config]", "error");
    },
  });
}
