# pi-model-router

A TypeScript pi extension for ordered model fallback. `src/index.ts` wires pi lifecycle
events, the footer status line, and `/model-router` to `RouterController`; pure config,
classification, and chain selection live in `src/config.ts`, `src/classify.ts`, and
`src/router.ts`, while `src/store.ts` owns SQLite history. The extension is always loaded
but routes only while armed, and only failures of chain-member models are ever routed.

## Build and test

- `npm run typecheck` checks source and test types against the installed pi APIs.
- `npm test` runs the five Vitest suites.
- `npm run build` emits `dist/`.

Use npm only. Runtime code has zero npm dependencies and requires Node 24 or newer for
`node:sqlite`.

## Project layout

```text
src/                 # Extension wiring and routing modules
test/                # Vitest suites for pure logic, storage, and controller behavior
```

The configuration file is `~/.pi/agent/extension-settings/pi-model-router.json`. The
SQLite history file is `~/.pi/agent/pi-model-router.db`. `src/controller.ts` keeps routing
state in memory and seeds cooldowns once from the store; later routing decisions use that
in-memory map.

## Constraints

Receipt comments accompany behavioral constants such as the config filename, database
filename, classification pattern, cooldown timing, retry values, and resume message. Do
not add tier routing, quota prediction, budgets, or UI beyond notifications, the footer
status entry, and the status text block.

## pi API facts this code depends on

Verified against pi 0.83.0 sources; each one caused a real defect when assumed otherwise.

- `after_provider_response` fires only for **successful** requests, so no HTTP status or
  header from a failed request ever reaches an extension. Failure classification must read
  the settled assistant message's `errorMessage`.
- `ctx.ui.notify` is a silent no-op in print and json modes. User-facing lines go through
  the `notify` wrapper in `src/index.ts`, which falls back to `console.error` when
  `ctx.hasUI` is false.
- Never capture `ctx` or a `ctx.*` function value across handlers: every
  `ExtensionContext` property is a guarded getter that throws once the instance is stale
  after a runtime replacement. `src/index.ts` re-assigns `lastCtx` at the top of every
  handler and all dependencies read through it at call time.
- `node:sqlite` throws `TypeError: Provided value cannot be bound` on an `undefined` bind
  parameter; optionals are coalesced to `null` at the bind site in `src/store.ts`.
- pi rebuilds the extension runtime on `/reload`, `/new`, `/resume`, and `/fork`:
  `session_shutdown` must close the SQLite handle or it leaks per rebuild, and all
  in-memory state resets, including the armed flag.
- `pi.sendUserMessage` is fire-and-forget — its failures are invisible to extensions, so
  the switch notification never claims the resume succeeded. It is deferred one microtask
  because calling it inside the `agent_settled` handler re-enters the agent loop while the
  previous run is still unwinding.
- pi's CLI parses unregistered `--flags` before extension types are known, so a boolean
  extension flag swallows the following argument as its value. Pass `--model-router` last,
  or as `--model-router=true`.
- pi's print mode is `-p`/`--print`; `--mode` accepts only `text|json|rpc` and silently
  ignores anything else.
