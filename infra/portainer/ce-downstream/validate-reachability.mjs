#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const allowedComposeMethods = new Set([
  "Build",
  "Create",
  "Down",
  "List",
  "MaxConcurrency",
  "Ps",
  "Pull",
  "RunOneOffContainer",
  "Up",
])
export const vulnerableArchiveCalls = new Set([
  "ApplyLayer",
  "CopyTo",
  "Unpack",
  "UnpackLayer",
  "Untar",
  "UntarUncompressed",
])

export const angularJsSecurityBoundary = Object.freeze({
  package: "angular",
  version: "1.8.2",
  lifecycle: "EOL_NO_UPSTREAM_FIX",
  findings: Object.freeze(["CVE-2024-21490", "CVE-2026-11998"]),
  reviewExpiresAt: "2026-09-22T23:59:59Z",
})

const angularJsPackages = new Map([
  ["angular", "1.8.2"],
  ["angular-messages", "1.8.2"],
  ["angular-mocks", "1.8.2"],
  ["angular-resource", "1.8.2"],
  ["angular-sanitize", "1.8.2"],
])

const frontendExtensions = new Set([
  ".ejs",
  ".html",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
])

const forbiddenAngularJsSource = [
  ["ng-srcset directive", /\b(?:data-|x-)?ng-srcset\b/i],
  ["$sceDelegateProvider customization", /\$sceDelegateProvider\b/],
  [
    "resource URL list customization",
    /\b(?:resourceUrl(?:White|Black|Allow|Block)(?:list|List)|(?:trusted|banned)ResourceUrlList)\b/i,
  ],
  ["trustAsResourceUrl call", /\btrustAsResourceUrl\s*\(/],
]

function isStaticString(expression) {
  return /^(?:'[^']*'|"[^"]*"|`[^`$]*`)$/.test(expression.trim())
}

function walk(root, current = "") {
  const files = []
  for (const entry of readdirSync(path.join(root, current), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(current, entry.name)
    if (entry.isDirectory()) files.push(...walk(root, relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

function validateAngularJsBoundary(root, files, now) {
  const errors = []
  const packagePath = path.join(root, "package.json")
  if (!existsSync(packagePath) || !lstatSync(packagePath).isFile()) {
    return ["Portainer package.json is missing"]
  }

  let packageManifest
  try {
    packageManifest = JSON.parse(readFileSync(packagePath, "utf8"))
  } catch {
    return ["Portainer package.json is invalid"]
  }
  if (
    packageManifest.name !== "@portainer/ce" ||
    packageManifest.version !== "2.39.6"
  ) {
    errors.push("Portainer frontend package identity differs")
  }
  for (const [name, version] of angularJsPackages) {
    if (packageManifest.dependencies?.[name] !== version) {
      errors.push(`locked AngularJS package identity differs: ${name}`)
    }
  }
  if (now.getTime() > Date.parse(angularJsSecurityBoundary.reviewExpiresAt)) {
    errors.push("AngularJS EOL security review has expired")
  }

  const frontendFiles = files.filter(
    (relative) =>
      relative.startsWith("app/") &&
      frontendExtensions.has(path.extname(relative).toLowerCase()),
  )
  for (const relative of frontendFiles) {
    const source = readFileSync(path.join(root, relative), "utf8")
    for (const [label, pattern] of forbiddenAngularJsSource) {
      if (pattern.test(source)) {
        errors.push(`${label}: ${relative}`)
      }
    }
    let dynamicResourceSink =
      /<(?:iframe|object|embed|script|link|base)\b[^>]*(?:\{\{|\bng-(?:src|href)\b)[^>]*>/s.test(
        source,
      )
    for (const match of source.matchAll(/\btemplateUrl\s*:\s*([^\r\n,}]+)/g)) {
      if (!isStaticString(match[1])) dynamicResourceSink = true
    }
    for (const match of source.matchAll(
      /\bng-include\s*=\s*(?:"([^"]*)"|'([^']*)')/gis,
    )) {
      if (!isStaticString(match[1] ?? match[2])) dynamicResourceSink = true
    }
    if (dynamicResourceSink) {
      errors.push(`dynamic AngularJS resource URL sink: ${relative}`)
    }
  }

  const composeHookRelative =
    "app/react/hooks/useDockerComposeSchema/useDockerComposeSchema.ts"
  const composeSchemaRelative =
    "app/react/hooks/useDockerComposeSchema/docker-compose-schema.ts"
  if (!files.includes(composeSchemaRelative)) {
    errors.push("bundled Docker Compose schema is missing")
  }
  if (!files.includes(composeHookRelative)) {
    errors.push("Docker Compose schema hook is missing")
  } else {
    const hook = readFileSync(path.join(root, composeHookRelative), "utf8")
    if (
      /https?:\/\/|raw\.githubusercontent\.com|\b(?:axios|fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(
        hook,
      )
    ) {
      errors.push("Docker Compose schema hook uses a remote or network source")
    }
    if (
      !hook.includes(
        "import { dockerComposeSchema } from './docker-compose-schema';",
      ) ||
      !hook.includes("Promise.resolve(dockerComposeSchema as JSONSchema7)")
    ) {
      errors.push("Docker Compose schema hook does not bind the local schema")
    }
  }
  return errors
}

function validateWebpackBoundary(root, files) {
  const webpackCommonRelative = "webpack/webpack.common.js"
  if (!files.includes(webpackCommonRelative)) {
    return ["Portainer production Webpack configuration is missing"]
  }
  const webpackCommon = readFileSync(
    path.join(root, webpackCommonRelative),
    "utf8",
  )
  if (
    /\bLodashModuleReplacementPlugin\b|\blodash-webpack-plugin\b/.test(
      webpackCommon,
    )
  ) {
    return ["Lodash Webpack module replacement remains enabled"]
  }
  return []
}

export function validateReachability(sourceRoot, options = {}) {
  const errors = []
  const root = path.resolve(sourceRoot)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    return ["Portainer source root is not a directory"]
  }
  const files = walk(root)
  const productionFiles = files.filter(
    (relative) =>
      relative.endsWith(".go") &&
      !relative.endsWith("_test.go") &&
      (relative.startsWith("api/") || relative.startsWith("pkg/")),
  )
  errors.push(
    ...validateAngularJsBoundary(root, files, options.now ?? new Date()),
  )
  errors.push(...validateWebpackBoundary(root, files))
  const observedComposeMethods = new Set()
  for (const relative of productionFiles) {
    const source = readFileSync(path.join(root, relative), "utf8")
    if (/["`]github\.com\/moby\/go-archive(?:\/[^"`\s]+)?["`]/.test(source)) {
      errors.push(`direct moby/go-archive import: ${relative}`)
    }
    for (const match of source.matchAll(
      /\bcomposeService\.([A-Za-z0-9_]+)\s*\(/g,
    )) {
      observedComposeMethods.add(match[1])
      if (!allowedComposeMethods.has(match[1])) {
        errors.push(`unapproved Compose method ${match[1]}: ${relative}`)
      }
    }
    if (/\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?Compose\.Copy\s*\(/.test(source)) {
      errors.push(`Compose.Copy is reachable: ${relative}`)
    }
    for (const method of vulnerableArchiveCalls) {
      const call = new RegExp(`\\b[A-Za-z_][A-Za-z0-9_]*\\.${method}\\s*\\(`)
      if (call.test(source)) {
        errors.push(`vulnerable archive call ${method}: ${relative}`)
      }
    }
  }
  for (const method of allowedComposeMethods) {
    if (!observedComposeMethods.has(method)) {
      errors.push(`expected Compose method is missing: ${method}`)
    }
  }
  const goModPath = path.join(root, "go.mod")
  if (!existsSync(goModPath) || !lstatSync(goModPath).isFile()) {
    errors.push("Portainer go.mod is missing")
    return [...new Set(errors)].sort()
  }
  const goMod = readFileSync(goModPath, "utf8")
  if (!goMod.includes("github.com/moby/go-archive v0.1.0 // indirect")) {
    errors.push("locked moby/go-archive module identity differs")
  }
  if (!goMod.includes("github.com/docker/compose/v2 v2.40.3")) {
    errors.push("locked Docker Compose module identity differs")
  }
  if (!goMod.includes("github.com/docker/cli v28.5.1+incompatible")) {
    errors.push("locked Docker CLI module identity differs")
  }
  return [...new Set(errors)].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sourceRoot = process.argv[2]
  if (!sourceRoot || process.argv.length !== 3) {
    console.error("usage: validate-reachability.mjs SOURCE_ROOT")
    process.exitCode = 1
  } else {
    const errors = validateReachability(sourceRoot)
    if (errors.length > 0) {
      console.error(errors.join("\n"))
      process.exitCode = 1
    } else {
      console.log("Portainer go-archive reachability boundary validated.")
    }
  }
}
