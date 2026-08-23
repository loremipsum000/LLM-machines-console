# syntax=docker.io/docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM --platform=linux/amd64 docker.io/library/node@sha256:673fce836d5a9185da33352682bfedb17c174d016370d08616748dff76fda862 AS ui
WORKDIR /source
COPY . .
RUN npm install --global /source/.llmm-build/pnpm-10.26.2.tgz \
  && pnpm install --frozen-lockfile --ignore-pnpmfile \
  && NODE_ENV=production PORTAINER_EDITION=CE pnpm run build --config webpack/webpack.production.js

FROM --platform=linux/amd64 docker.io/library/golang@sha256:40dfc169bd5ad8a8617e49c8ead7fe16c6873e79d6937539e9c2e5947b7984ef AS server
ARG SOURCE_DATE_EPOCH=1786575764
WORKDIR /source
COPY . .
COPY --from=ui /source/dist/public /source/dist/public
RUN GOTOOLCHAIN=local go mod verify \
  && GOTOOLCHAIN=local go mod tidy -diff \
  && mkdir -p /source/dist/mustache-templates \
  && cp -R /source/mustache-templates/. /source/dist/mustache-templates/ \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOTOOLCHAIN=local go build \
    -mod=readonly \
    -trimpath \
    -buildvcs=false \
    -ldflags="-s -w -buildid= \
      -X 'github.com/portainer/liblicense.LicenseServerBaseURL=https://api.portainer.io' \
      -X 'github.com/portainer/portainer/pkg/build.BuildNumber=2.39.6-llmm.1' \
      -X 'github.com/portainer/portainer/pkg/build.ImageTag=2.39.6-llmm.1' \
      -X 'github.com/portainer/portainer/pkg/build.NodejsVersion=v22.23.2' \
      -X 'github.com/portainer/portainer/pkg/build.PnpmVersion=10.26.2' \
      -X 'github.com/portainer/portainer/pkg/build.WebpackVersion=5.105.0' \
      -X 'github.com/portainer/portainer/pkg/build.GitCommit=723d1a2268f0fefe70d57f5981ce15d5d1ffc679' \
      -X 'github.com/portainer/portainer/pkg/build.GoVersion=go1.25.13' \
      -X 'github.com/portainer/portainer/pkg/build.DepComposeVersion=v2.40.3' \
      -X 'github.com/portainer/portainer/pkg/build.DepDockerVersion=v28.5.1+incompatible' \
      -X 'github.com/portainer/portainer/pkg/build.DepKubectlVersion=v1.35.1' \
      -X 'github.com/portainer/portainer/pkg/build.DepHelmVersion=v3.20.2'" \
    -o /source/dist/portainer \
    ./api/cmd/portainer \
  && mkdir -p /rootfs/data /rootfs/tmp /rootfs/etc/ssl/certs \
  && chmod 0700 /rootfs/data \
  && chmod 1777 /rootfs/tmp \
  && cp /source/dist/portainer /rootfs/portainer \
  && cp -R /source/dist/public /rootfs/public \
  && cp -R /source/dist/mustache-templates /rootfs/mustache-templates \
  && cp /source/LICENSE /rootfs/LICENSE \
  && cp /source/ATTRIBUTIONS.md /rootfs/ATTRIBUTIONS.md \
  && cp /etc/ssl/certs/ca-certificates.crt /rootfs/etc/ssl/certs/ca-certificates.crt \
  && find /rootfs -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +

FROM scratch
ARG SOURCE_DATE_EPOCH=1786575764
COPY --from=server /rootfs/ /
LABEL org.opencontainers.image.title="Portainer CE downstream" \
  org.opencontainers.image.description="LLM Machines security-rebuilt Portainer Community Edition; altered from upstream 2.39.6" \
  org.opencontainers.image.vendor="LLM Machines" \
  org.opencontainers.image.version="2.39.6-llmm.1" \
  org.opencontainers.image.revision="723d1a2268f0fefe70d57f5981ce15d5d1ffc679" \
  org.opencontainers.image.source="https://github.com/portainer/portainer" \
  org.opencontainers.image.licenses="Zlib" \
  org.opencontainers.image.created="2026-08-12T23:02:44Z" \
  io.llm-machines.downstream.altered="true" \
  io.llm-machines.runtime-qualified="false"
VOLUME ["/data"]
EXPOSE 9000 9443 8000
ENTRYPOINT ["/portainer"]
