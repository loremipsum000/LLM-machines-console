FROM node:22.23.2-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bff/package.json apps/bff/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/copy/package.json packages/copy/package.json

RUN corepack pnpm install --frozen-lockfile --filter @llm-machines/bff...

COPY apps/bff apps/bff
COPY packages/contracts packages/contracts

RUN corepack pnpm --filter @llm-machines/contracts build

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

CMD ["corepack", "pnpm", "--filter", "@llm-machines/bff", "exec", "tsx", "src/production-entrypoint.ts"]
