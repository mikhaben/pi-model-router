# pi-model-router

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Ordered model fallback for [pi](https://pi.dev). You define a chain of models; when the
one you're on stops working, the router moves to the next and picks the task back up.

It is always loaded but engages only on demand — run `/model-router on` to arm it.
While armed, a settled run that ends in a provider limit or error switches to the next
eligible model in your chain and sends `Continue.`. Failures on models outside the chain
are ignored, so sessions on a model you chose deliberately are never redirected.
Every failure and switch is recorded in SQLite.

Rate-limited free tiers are the obvious case, but nothing here is free-tier specific: any
model pi can reach can sit in the chain, in whatever order you want.

## Features

- Ordered `provider/model-id` chain, armed with `/model-router on` or `pi --model-router`
- Automatic advance on provider limits and errors, with a resume nudge
- Daily cooldowns for hard limits, so an exhausted quota is skipped until it resets
- Per-minute throttles advance without burning a model for the day
- SQLite history of every failure and switch
- Footer status line showing the routed model and cooling count
- Zero runtime dependencies

## Install

```sh
pi install npm:@mikhaben/pi-model-router
```

From a local checkout, symlink it into pi's extension directory:

```sh
ln -s "$PWD" ~/.pi/agent/extensions/pi-model-router
```

## Configuration

Create `~/.pi/agent/extension-settings/pi-model-router.json` with your chain, best choice
first:

```json
{
  "chain": [
    "vercel-ai-gateway/poolside/laguna-s-2.1-free",
    "openrouter/poolside/laguna-s-2.1:free",
    "opencode/hy3-free"
  ]
}
```

Each entry splits at its **first** `/`, so model ids may contain more slashes. Confirm an
id with `pi --list-models` before adding it; unknown entries are reported at startup and
skipped when routing.

A hard limit (quota exhausted, billing, payment required) cools that model until the next
UTC midnight. Ordinary errors and per-minute throttles advance to the next model without a
cooldown, so a short-lived `429` never costs you a model for the rest of the day.

History lives in `~/.pi/agent/pi-model-router.db`, an append-only event log that seeds
cooldowns at startup and backs `/model-router status`.

## Commands

| Command | Action |
| --- | --- |
| `/model-router` | Show armed/off state and the command list |
| `/model-router on` | Arm routing and switch onto a usable chain entry |
| `/model-router off` | Disarm routing |
| `/model-router next` | Manually advance to the next eligible entry |
| `/model-router status` | Show chain order, current/cooling markers, and today's limit counts |

Launchers can arm routing at session start with `pi --model-router`, equivalent to
`/model-router on`. Put the flag last on the command line (or write `--model-router=true`):
pi parses unregistered flags before it knows their type, so a prompt written right after
the flag is swallowed as its value.

While armed, the footer shows `router:<model>` when the session is on a chain model and
`router:armed` otherwise, with a `(n cooling)` suffix when cooldowns are active. Arming
resets on `/reload`, `/new`, `/resume`, and `/fork` — run `/model-router on` again.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Requires Node.js 24 or newer for `node:sqlite`. TypeScript source is in `src/`, tests in
`test/`, and the extension entry point is `src/index.ts`.

## License

MIT
