FROM node:22-bookworm-slim

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/reranker-api/package.json apps/reranker-api/package.json

RUN corepack pnpm install --frozen-lockfile --filter @llm-machines/reranker-api...

COPY apps/reranker-api apps/reranker-api

ENV HOST=0.0.0.0
ENV PORT=8000

EXPOSE 8000

CMD ["corepack", "pnpm", "--filter", "@llm-machines/reranker-api", "exec", "tsx", "src/index.ts"]
