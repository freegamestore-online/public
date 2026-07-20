# @freegamestore/public

Public creator packages for [FreeGameStore](https://freegamestore.online) — SDK, CLI, and compliance tooling for game development and publishing.

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| `packages/games-sdk` | [`@freegamestore/games`](https://www.npmjs.com/package/@freegamestore/games) | React UI primitives (GameShell, GameTopbar, useAuth, useLeaderboard) |
| `packages/fgs-cli` | [`@freegamestore/cli`](https://www.npmjs.com/package/@freegamestore/cli) | CLI for scaffolding and publishing games |
| `packages/compliance` | [`@freegamestore/compliance`](https://www.npmjs.com/package/@freegamestore/compliance) | Compliance checks (brand, accessibility, security) |

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```

## Production E2E

`Prod platform e2e` runs daily and manually from GitHub Actions. It checks the
live production surfaces that must work for creators: storefront, console,
auth gates, console APIs, agent health/session/key endpoints, leaderboard,
sample hosted games, and the full real create path.

The mutating portion creates a real hidden `*-test` game through
`console.freegamestore.online/api/create`, verifies the GitHub repo is public,
waits for the game host to serve, verifies the fixture is hidden from the public
store registry, then deletes it through the owner-checked admin API and verifies
cleanup.

Required repo secret:

```bash
gh secret set FGS_E2E_GITHUB_TOKEN --repo freegamestore-online/public
```

Use a low-privilege canary creator GitHub token. The auth worker exchanges it for
a fresh `fgs_token` at run time.

## Publishing

OIDC trusted publishing via GitHub Actions. Bump version and push:

```bash
cd packages/games-sdk
npm version patch
git push --follow-tags
```

## License

MIT
