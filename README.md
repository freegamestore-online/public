# @freegamestore/platform

Platform monorepo for [FreeGameStore](https://freegamestore.online) — publishable npm packages for game development and publishing.

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

## Production Canaries

`Prod create canary` runs daily and manually from GitHub Actions. It creates a real
hidden `*-test` game through `console.freegamestore.online/api/create`, waits for
the game host to serve, then deletes it through the owner-checked admin API.

Required repo secret:

```bash
gh secret set FGS_E2E_GITHUB_TOKEN --repo freegamestore-online/platform
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
