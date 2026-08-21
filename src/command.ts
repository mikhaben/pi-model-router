import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { configPath } from "./config.js";
import { RouterController } from "./controller.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const VERBS = ["on", "off", "status", "next"] as const;
const EXAMPLE_BODY = "{\"chain\":[\"provider/model-id\",\"provider/fallback-model-id\"]} (see pi-model-router.example.json)";
const HELP = [
  "/model-router on — arm routing and switch onto the chain",
  "/model-router off — disarm routing",
  "/model-router status — chain order, cooldowns, today's limit counts",
  "/model-router next — advance to the next eligible model",
].join("\n");

type NotifyType = "info" | "warning" | "error";

export function registerModelRouterCommand(
  pi: ExtensionAPI,
  controller: () => RouterController | undefined,
  notify: (message: string, type: NotifyType) => void,
): void {
  pi.registerCommand("model-router", {
    description: "Model-router fallback routing: on | off | status | next",
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
        notify(`${instance.active ? "armed" : "off"}\n${HELP}`, "info");
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
        notify(instance.statusText(), "info");
        return;
      }

      notify("Usage: /model-router [on|off|status|next]", "error");
    },
  });
}
