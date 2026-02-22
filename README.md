# ReleaseKit

Release tooling for automated versioning and changelog generation.

## Packages

| Package | Description |
|---------|-------------|
| [@releasekit/version](./packages/version) | Semantic versioning based on Git history and conventional commits |
| [@releasekit/notes](./packages/notes) | Changelog generation with LLM-powered enhancement and flexible templating |

## Usage

The packages are designed to work together:

```bash
# Version packages and output JSON
@releasekit/version --json

# Generate changelogs from version output
@releasekit/version --json | @releasekit/notes
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint and typecheck
pnpm lint
pnpm typecheck
```

## License

MIT
