import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  allowedComposeMethods,
  angularJsSecurityBoundary,
  validateReachability,
  vulnerableArchiveCalls,
} from "./validate-reachability.mjs"

const lockedGoMod = `module github.com/portainer/portainer/api

go 1.25.0

require (
	github.com/docker/cli v28.5.1+incompatible
	github.com/docker/compose/v2 v2.40.3
	github.com/moby/go-archive v0.1.0 // indirect
)
`

const lockedPackageJson = JSON.stringify({
  name: "@portainer/ce",
  version: "2.39.6",
  dependencies: {
    angular: "1.8.2",
    "angular-messages": "1.8.2",
    "angular-mocks": "1.8.2",
    "angular-resource": "1.8.2",
    "angular-sanitize": "1.8.2",
  },
})

const localComposeSchemaHook = `import { JSONSchema7 } from 'json-schema';
import { dockerComposeSchema } from './docker-compose-schema';

export function getDockerComposeSchema(): Promise<JSONSchema7> {
  return Promise.resolve(dockerComposeSchema as JSONSchema7);
}
`

function productionSource(methods = allowedComposeMethods) {
  return `package compose

func exercise() {
${[...methods].map((method) => `	composeService.${method}()`).join("\n")}
}
`
}

function write(root, relative, contents) {
  const file = path.join(root, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "llmm-portainer-reachability-"))
  write(root, "go.mod", lockedGoMod)
  write(root, "package.json", lockedPackageJson)
  write(
    root,
    "webpack/webpack.common.js",
    "module.exports = { plugins: [] };\n",
  )
  write(root, "api/compose.go", productionSource())
  write(
    root,
    "app/static-component.js",
    "export const templateUrl = './view.html'\n",
  )
  write(
    root,
    "app/react/hooks/useDockerComposeSchema/docker-compose-schema.ts",
    "export const dockerComposeSchema = { type: 'object' }\n",
  )
  write(
    root,
    "app/react/hooks/useDockerComposeSchema/useDockerComposeSchema.ts",
    localComposeSchemaHook,
  )
  return root
}

function withFixture(callback) {
  const root = createFixture()
  try {
    callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("the locked non-executable go-archive boundary passes", () => {
  withFixture((root) => {
    assert.deepEqual(validateReachability(root), [])
  })
})

test("Lodash Webpack module replacement import and invocation fail closed", () => {
  for (const source of [
    "const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');\n",
    "module.exports = { plugins: [new LodashModuleReplacementPlugin()] };\n",
  ]) {
    withFixture((root) => {
      write(root, "webpack/webpack.common.js", source)
      assert.ok(
        validateReachability(root).includes(
          "Lodash Webpack module replacement remains enabled",
        ),
        source,
      )
    })
  }
})

test("direct go-archive imports and subpackage imports fail", () => {
  for (const imported of [
    '"github.com/moby/go-archive"',
    'archive "github.com/moby/go-archive/tar"',
    "`github.com/moby/go-archive`",
  ]) {
    withFixture((root) => {
      write(
        root,
        "pkg/archive/use.go",
        `package archive\n\nimport ${imported}\n`,
      )
      assert.ok(
        validateReachability(root).some((error) =>
          error.includes("direct moby/go-archive import"),
        ),
        imported,
      )
    })
  }
})

test("Compose.Copy fails the source guard", () => {
  withFixture((root) => {
    write(
      root,
      "api/archive.go",
      "package archive\n\nfunc copy() { api.Compose.Copy() }\n",
    )
    assert.ok(
      validateReachability(root).some((error) =>
        error.includes("Compose.Copy is reachable"),
      ),
    )
  })
})

test("every forbidden archive call fails the source guard", () => {
  for (const method of vulnerableArchiveCalls) {
    withFixture((root) => {
      write(
        root,
        "pkg/archive/use.go",
        `package archive\n\nfunc unsafe() { archive.${method}() }\n`,
      )
      assert.ok(
        validateReachability(root).some((error) =>
          error.includes(`vulnerable archive call ${method}`),
        ),
        method,
      )
    })
  }
})

test("an unexpected Compose method fails", () => {
  withFixture((root) => {
    write(
      root,
      "api/compose.go",
      `${productionSource()}\nfunc copy() { composeService.Copy() }\n`,
    )
    assert.ok(
      validateReachability(root).some((error) =>
        error.includes("unapproved Compose method Copy"),
      ),
    )
  })
})

test("each expected Compose method is required", () => {
  for (const missing of allowedComposeMethods) {
    withFixture((root) => {
      const retained = [...allowedComposeMethods].filter(
        (method) => method !== missing,
      )
      write(root, "api/compose.go", productionSource(retained))
      assert.ok(
        validateReachability(root).includes(
          `expected Compose method is missing: ${missing}`,
        ),
        missing,
      )
    })
  }
})

test("locked module identities are required", () => {
  withFixture((root) => {
    write(root, "go.mod", lockedGoMod.replace("v0.1.0", "v0.3.0"))
    assert.ok(
      validateReachability(root).includes(
        "locked moby/go-archive module identity differs",
      ),
    )
  })
})

test("the AngularJS EOL boundary is exact and expires for re-review", () => {
  assert.deepEqual(angularJsSecurityBoundary, {
    package: "angular",
    version: "1.8.2",
    lifecycle: "EOL_NO_UPSTREAM_FIX",
    findings: ["CVE-2024-21490", "CVE-2026-11998"],
    reviewExpiresAt: "2026-09-22T23:59:59Z",
  })
  withFixture((root) => {
    assert.ok(
      validateReachability(root, {
        now: new Date("2026-09-23T00:00:00Z"),
      }).includes("AngularJS EOL security review has expired"),
    )
  })
})

test("every exact AngularJS package identity is required", () => {
  for (const name of [
    "angular",
    "angular-messages",
    "angular-mocks",
    "angular-resource",
    "angular-sanitize",
  ]) {
    withFixture((root) => {
      const manifest = JSON.parse(lockedPackageJson)
      manifest.dependencies[name] = "1.8.1"
      write(root, "package.json", JSON.stringify(manifest))
      assert.ok(
        validateReachability(root).includes(
          `locked AngularJS package identity differs: ${name}`,
        ),
        name,
      )
    })
  }
})

test("AngularJS ng-srcset and SCE policy escape hatches fail closed", () => {
  for (const [label, source] of [
    ["ng-srcset directive", '<img ng-srcset="{{ value }}">'],
    [
      "$sceDelegateProvider customization",
      "module.config(($sceDelegateProvider) => {})",
    ],
    [
      "resource URL list customization",
      "provider.trustedResourceUrlList(['self'])",
    ],
    [
      "resource URL list customization",
      "provider.resourceUrlWhitelist(['self'])",
    ],
    ["trustAsResourceUrl call", "$sce.trustAsResourceUrl(value)"],
  ]) {
    withFixture((root) => {
      write(root, "app/unsafe.html", source)
      assert.ok(
        validateReachability(root).some((error) => error.includes(label)),
        source,
      )
    })
  }
})

test("dynamic AngularJS resource URL sinks fail while static templates pass", () => {
  for (const source of [
    '<iframe ng-src="{{ externalUrl }}"></iframe>',
    "const component = { templateUrl: chooseTemplate() }",
    '<div ng-include="templateFromUser"></div>',
  ]) {
    withFixture((root) => {
      write(root, "app/dynamic-resource.html", source)
      assert.ok(
        validateReachability(root).includes(
          "dynamic AngularJS resource URL sink: app/dynamic-resource.html",
        ),
        source,
      )
    })
  }
  withFixture((root) => {
    write(
      root,
      "app/static-resource.html",
      "<div ng-include=\"'./static-view.html'\"></div>",
    )
    assert.deepEqual(validateReachability(root), [])
  })
})

test("the Docker Compose schema hook rejects remote and network sources", () => {
  for (const source of [
    `${localComposeSchemaHook}\nconst url = 'https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json'\n`,
    `${localComposeSchemaHook}\nfetch('/compose-schema.json')\n`,
    `${localComposeSchemaHook}\naxios.get('/compose-schema.json')\n`,
  ]) {
    withFixture((root) => {
      write(
        root,
        "app/react/hooks/useDockerComposeSchema/useDockerComposeSchema.ts",
        source,
      )
      assert.ok(
        validateReachability(root).includes(
          "Docker Compose schema hook uses a remote or network source",
        ),
        source,
      )
    })
  }
})

test("the Docker Compose schema hook requires the bundled local schema", () => {
  withFixture((root) => {
    write(
      root,
      "app/react/hooks/useDockerComposeSchema/useDockerComposeSchema.ts",
      "export function getDockerComposeSchema() { return Promise.resolve({}) }\n",
    )
    assert.ok(
      validateReachability(root).includes(
        "Docker Compose schema hook does not bind the local schema",
      ),
    )
  })
})

test("a missing source root and go.mod fail closed", () => {
  const missing = path.join(tmpdir(), `llmm-portainer-missing-${process.pid}`)
  assert.deepEqual(validateReachability(missing), [
    "Portainer source root is not a directory",
  ])
  const root = mkdtempSync(path.join(tmpdir(), "llmm-portainer-no-mod-"))
  try {
    write(root, "package.json", lockedPackageJson)
    write(root, "api/compose.go", productionSource())
    assert.ok(
      validateReachability(root).includes("Portainer go.mod is missing"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
