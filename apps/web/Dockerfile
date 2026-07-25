FROM node:22-bookworm-slim

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/copy/package.json packages/copy/package.json

COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/copy packages/copy

RUN corepack pnpm install --frozen-lockfile

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN corepack pnpm --filter @llm-machines/web build

EXPOSE 3000

CMD ["corepack", "pnpm", "--dir", "apps/web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
