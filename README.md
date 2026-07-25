# LLM Machines Console

Administration and operations console for the LLM Machines on-prem inference
appliance.

## Structure

- `apps/web` - Next.js administration interface
- `apps/bff` - Fastify backend-for-frontend
- `apps/sidecar` - FastAPI AI sidecar
- `packages/contracts` - shared Zod contracts
- `packages/copy` - shared UX copy and localization

The repository is undergoing an inference-core product reduction. This
clean-root publication is a source checkpoint, not a production release.

## Security

Internal deployment topology, operational runbooks, environment credentials,
and customer-specific configuration are intentionally excluded. The example
environment file contains no credential values. Generate all secrets outside
Git and inject them at runtime.

Do not report security vulnerabilities through a public issue.
