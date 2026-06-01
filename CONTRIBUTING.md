# Contributing

Thanks for contributing. This project is intentionally small, typed, and evidence-first. Please keep changes easy to review and easy to operate.

## Development Workflow

1. Install dependencies with `corepack pnpm install`
2. Copy `.env.example` to `.env`
3. Run `corepack pnpm check`
4. Make focused changes
5. Regenerate sample outputs when behavior changes: `corepack pnpm generate:samples`

## Project Expectations

- Prefer deterministic heuristics over opaque behavior
- Do not fabricate missing values
- Preserve explicit provenance for generated repro steps
- Keep root-cause claims evidence-backed
- Never log raw secrets or unredacted sensitive payloads
- Add or update tests for behavior changes

## Code Style

- Use small composable functions
- Keep comments rare and high-signal
- Reuse existing schemas and shared types
- Prefer extending provider interfaces over adding provider-specific logic in the core pipeline

## Pull Request Checklist

- [ ] Build passes
- [ ] Tests pass
- [ ] Documentation is updated if behavior changed
- [ ] Sample outputs were regenerated if artifact output changed
- [ ] Sensitive data is still redacted in all new paths
