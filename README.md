# LLM Machines Console

Administration and operations console for the LLM Machines on-prem inference
appliance.

## Structure

- `apps/web` - reduced Next.js administration interface
- `apps/bff` - Fastify control plane and Application gateway
- `packages/contracts` - retained inference and administration contracts
- `packages/copy` - retained product and authentication copy

The product source contains the API-first inference control plane. Customer
chat and agent interfaces are third-party applications and are not included
in this repository.

The repository is undergoing an inference-core product reduction. This
clean-root publication is a source checkpoint, not a production release.

## Security

Internal deployment topology, operational runbooks, environment credentials,
and customer-specific configuration are intentionally excluded. The example
environment file contains no credential values. Generate all secrets outside
Git and inject them at runtime.

Do not report security vulnerabilities through a public issue.
