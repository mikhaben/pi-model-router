import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { registerModelRouterCommand } from "./command.js";
import { loadConfig } from "./config.js";
import { RESUME_MESSAGE, RouterController } from "./controller.js";
import { DB_FILENAME, openStore, type RouterStore } from "./store.js";

export default function (pi: ExtensionAPI): void {
  let lastCtx: ExtensionContext | undefined;
  let controller: RouterController | undefined;
  let store: RouterStore | undefined;

  const notify = (message: string, type: "info" | "warning" | "error"): void => {
    if (lastCtx?.hasUI) {
      lastCtx.ui.notify(message, type);
    } else {
      console.error(`[pi-model-router] ${message}`);
    }
  };

  const setStatus = (text: string | undefined): void => {
    if (!lastCtx?.hasUI) return;
    if (text === undefined) {
      lastCtx.ui.setStatus("router", undefined);
      return;
    }
    const theme = lastCtx.ui.theme;
    lastCtx.ui.setStatus("router", `${theme.bold("router:")}${theme.fg("accent", text)}`);
  };

  pi.registerFlag("model-router", {
    description: "Arm model routing at launch (same as /model-router on)",
    type: "boolean",
  });

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    controller = undefined;
    store = undefined;

    const loaded = loadConfig(getAgentDir());
    for (const warning of loaded.warnings) notify(warning, "warning");
    if (loaded.chain.length === 0) return;

    const unknown = loaded.chain.filter(
      (entry) => !ctx.modelRegistry.find(entry.provider, entry.modelId),
    );
    if (unknown.length > 0) {
      notify(
        `models not in pi's catalog: ${unknown.map((entry) => entry.raw).join(", ")}`,
        "warning",
      );
    }

    let historyErrorReported = false;
    const opened = openStore(
      join(getAgentDir(), DB_FILENAME),
      (message) => {
        if (historyErrorReported) return;
        historyErrorReported = true;
        notify(`history off: ${message}`, "warning");
      },
    );
    if ("error" in opened) {
      notify(`history off: ${opened.error}`, "warning");
    } else {
      store = opened.store;
    }

    controller = new RouterController(loaded.chain, {
      resolveModel: (entry) => lastCtx!.modelRegistry.find(entry.provider, entry.modelId),
      setModel: (model) => pi.setModel(model),
      currentModel: () => {
        const model = lastCtx?.model;
        return model ? { provider: model.provider, id: model.id } : undefined;
      },
      sendContinue: () => queueMicrotask(() => pi.sendUserMessage(RESUME_MESSAGE)),
      notify,
      setThinking: (level) => pi.setThinkingLevel(level),
      setStatus,
      store,
      now: () => Date.now(),
    });

    if (pi.getFlag("model-router")) await controller.activate();
  });

  pi.on("model_select", (_event, ctx) => {
    lastCtx = ctx;
    controller?.refreshStatus();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    lastCtx = ctx;
    store?.close();
    store = undefined;
    controller = undefined;
  });

  pi.on("input", (event, ctx) => {
    lastCtx = ctx;
    controller?.noteUserInput(event.source);
  });

  pi.on("agent_end", (event, ctx) => {
    lastCtx = ctx;
    const assistant = [...event.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    controller?.noteAssistantMessage(assistant?.stopReason, assistant?.errorMessage);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    lastCtx = ctx;
    await controller?.onSettled();
  });

  registerModelRouterCommand(pi, () => controller, notify);
}
