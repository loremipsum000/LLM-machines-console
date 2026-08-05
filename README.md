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

## Disposable reduced-Core development lane

Run `corepack pnpm dev:reduced-core` to start Console Web, the BFF, a strict
four-authority local router, and an OpenAI-compatible deterministic inference
double. The command creates throwaway credentials and state under the operating
system temporary directory, prints no credential values, and removes only that
created directory when stopped with Ctrl-C.

The four local HTTP authorities are printed at startup. This lane supports
control-plane and Application-flow development on arm64. It is not evidence for
Product Nginx or TLS, Keycloak login, exact Core images, SGLang, persistence,
runtime no-bypass, or production capacity. The Identity authority deliberately
returns a controlled unavailable response until a separate browser and session
functional package supplies a qualified identity fixture.

Run `corepack pnpm dev:reduced-core -- --check` for a bounded startup and
cleanup check.

## Security

Internal deployment topology, operational runbooks, environment credentials,
and customer-specific configuration are intentionally excluded. The example
environment file contains no credential values. Generate all secrets outside
Git and inject them at runtime.

Do not report security vulnerabilities through a public issue.
