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

After `corepack pnpm install --frozen-lockfile` and `corepack pnpm build`, run
`node scripts/pre-genesis/reduced-core-dev.mjs` to start Console Web, the BFF, a
strict four-authority local router, and an OpenAI-compatible deterministic
inference double. The runtime command creates throwaway credentials, logs, and
the Next development output under one operating-system temporary directory. It
prints no credential values and removes only that created directory when
stopped with Ctrl-C.

The four local HTTP authorities are printed at startup. This lane supports
control-plane and Application-flow development on arm64. It is not evidence for
Product Nginx or TLS, Keycloak login, exact Core images, SGLang, persistence,
runtime no-bypass, or production capacity. The Identity authority deliberately
returns a controlled unavailable response until a separate browser and session
functional package supplies a qualified identity fixture. Application
credential, gateway-accounting, rotation, revocation, and isolation are not
proved by the bootstrap check alone.

Run `node scripts/pre-genesis/reduced-core-dev.mjs --check` for a bounded
startup and cleanup check.

Run `node scripts/pre-genesis/reduced-core-dev.mjs --vertical-slice` for the
bounded F0-L1 Application-to-inference flow. It creates two temporary
Applications through the Console BFF control surface, uses a generated
Application credential through the API authority for non-streaming and
streaming Chat Completions, verifies usage and last-use metadata, rotates and
revokes the credential, proves cross-Application policy and credential-record
isolation, and removes the temporary runtime. Its JSON result contains only
status and accounting metadata. It does not print credentials, prompts, or
completion content.

## Security

Internal deployment topology, operational runbooks, environment credentials,
and customer-specific configuration are intentionally excluded. The example
environment file contains no credential values. Generate all secrets outside
Git and inject them at runtime.

Do not report security vulnerabilities through a public issue.
