# LLM Machines Product Core

Source authority for the LLM Machines Core Appliance.

## Architecture

- `product-edge`: only customer ingress
- `console-web`: Admin and Operator Console
- `console-bff`: control plane and Application API gateway
- `keycloak`: appliance identity and SSO
- `postgresql`: Product and identity state
- `litellm`: private inference gateway
- `firecrawl`: governed search and static scrape
- `prometheus`, `alertmanager`, `grafana`: observability
- `sglang`: separate private inference plane

Console is the primary customer surface. Retained native administration uses
dedicated Product-edge authorities and separate native sessions. Private
service ports are never customer ingress.
Portainer remains deferred for upstream security work. It is not admitted.

## Repository

- `apps/`: Product Web and BFF
- `packages/`: shared contracts and copy
- `infra/`: generic build, service, release and deployment contracts
- `scripts/`: validation and release tooling
- `test-support/`: required integration fixtures

## Validate

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm test:release
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm check:genesis
```

## Source Genesis

`infra/genesis/source-classification.json` assigns every tracked path exactly
one inclusion or exclusion class. The Genesis generator fails on unknown,
duplicate or unsafe paths and records both the input Git identity and the
filtered tree and archive digests.

Genesis is a source milestone. It is not a release, signature, image
promotion, production acceptance or customer deployment. Do not commit
credentials, customer configuration, customer data, model weights or signing
keys.

## Licensing

Original first-party Product source is source-available under the unmodified
PolyForm Internal Use License 1.0.0 in `LICENSE`. Third-party components and
upstream-derived material retain their existing upstream licences. See
`THIRD_PARTY_NOTICES.md` and `infra/release/third-party-source-map.json`.

The LLM Machines name, marks and logo assets are not licensed by the Product
software licence.
