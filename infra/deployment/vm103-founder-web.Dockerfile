FROM node:22.23.2-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

ARG LLMM_SOURCE_COMMIT
ARG LLMM_SOURCE_TREE
RUN printf '%s\n' "$LLMM_SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' \
    && printf '%s\n' "$LLMM_SOURCE_TREE" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.revision="$LLMM_SOURCE_COMMIT"
LABEL com.llm-machines.source.tree="$LLMM_SOURCE_TREE"

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/copy/package.json packages/copy/package.json
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/copy packages/copy
COPY scripts/pre-genesis/runtime-secret-entrypoint.mjs scripts/pre-genesis/runtime-secret-entrypoint.mjs
RUN corepack pnpm install --frozen-lockfile

ENV HOSTNAME=127.0.0.1
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=34954
RUN corepack pnpm --filter @llm-machines/web build

CMD ["node", "scripts/pre-genesis/runtime-secret-entrypoint.mjs", "corepack", "pnpm", "--dir", "apps/web", "exec", "next", "start", "-H", "127.0.0.1", "-p", "34954"]
