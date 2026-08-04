import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  validateApplicationCommissioningPlan,
  validateApplicationKeycloakSeed,
  validateCommissioningPlan,
  validateKeycloakSeed,
  validateRealmIsolation,
} from "../../scripts/inference-core/pr05-keycloak-seed.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(directory, "../..")
const allowedInitialStateRows = [
  "INSERT INTO admin.backup_state (id) VALUES ('singleton');",
  "INSERT INTO admin.console_settings (id) VALUES ('singleton');",
  "INSERT INTO admin.emergency_isolation_state (id) VALUES ('appliance');",
  "INSERT INTO admin.license_state (id) VALUES ('singleton');",
  "INSERT INTO admin.recovery_state (id) VALUES ('singleton');",
  "INSERT INTO admin.update_state (id) VALUES ('singleton');",
]

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function gitIdentity(root) {
  const git = (...arguments_) =>
    execFileSync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
    }).trim()
  if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") {
    fail("clean seed generation requires a clean Git worktree")
  }
  return {
    sourceCommit: git("rev-parse", "HEAD^{commit}"),
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    sourceDateEpoch: Number.parseInt(
      git("show", "-s", "--format=%ct", "HEAD"),
      10,
    ),
  }
}

function writeExclusiveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${canonicalJson(value)}\n`, { flag: "wx" })
}

function readJson(path, field) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

function loadKeycloakArtifactsFromRoot(root) {
  return {
    seed: readJson(
      resolve(root, "infra/keycloak/inference-core-realm-seed.json"),
      "human Keycloak realm seed",
    ),
    commissioning: readJson(
      resolve(root, "infra/keycloak/inference-core-commissioning.json"),
      "human Keycloak commissioning plan",
    ),
    applicationSeed: readJson(
      resolve(
        root,
        "infra/keycloak/inference-core-application-realm-seed.json",
      ),
      "application Keycloak realm seed",
    ),
    applicationCommissioning: readJson(
      resolve(
        root,
        "infra/keycloak/inference-core-application-realm-commissioning.json",
      ),
      "application Keycloak commissioning plan",
    ),
  }
}

function stripSqlComments(source) {
  let output = ""
  let index = 0
  let state = "normal"
  let blockDepth = 0
  let dollarDelimiter = ""
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (state === "line-comment") {
      if (character === "\n") {
        output += character
        state = "normal"
      } else {
        output += " "
      }
      index += 1
      continue
    }
    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        output += "  "
        blockDepth += 1
        index += 2
      } else if (character === "*" && next === "/") {
        output += "  "
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) state = "normal"
      } else {
        output += character === "\n" ? "\n" : " "
        index += 1
      }
      continue
    }
    if (state === "single-quote") {
      output += character
      if (character === "'" && next === "'") {
        output += next
        index += 2
      } else {
        index += 1
        if (character === "'") state = "normal"
      }
      continue
    }
    if (state === "double-quote") {
      output += character
      if (character === '"' && next === '"') {
        output += next
        index += 2
      } else {
        index += 1
        if (character === '"') state = "normal"
      }
      continue
    }
    if (state === "dollar-quote") {
      if (source.startsWith(dollarDelimiter, index)) {
        output += dollarDelimiter
        index += dollarDelimiter.length
        state = "normal"
      } else {
        output += character
        index += 1
      }
      continue
    }
    if (character === "-" && next === "-") {
      output += "  "
      state = "line-comment"
      index += 2
    } else if (character === "/" && next === "*") {
      output += "  "
      state = "block-comment"
      blockDepth = 1
      index += 2
    } else if (character === "'") {
      output += character
      state = "single-quote"
      index += 1
    } else if (character === '"') {
      output += character
      state = "double-quote"
      index += 1
    } else if (character === "$") {
      const delimiter = source.slice(index).match(/^\$[A-Za-z_0-9]*\$/)?.[0]
      if (delimiter) {
        output += delimiter
        dollarDelimiter = delimiter
        state = "dollar-quote"
        index += delimiter.length
      } else {
        output += character
        index += 1
      }
    } else {
      output += character
      index += 1
    }
  }
  if (state === "block-comment")
    fail("database seed contains an unterminated comment")
  return output
}

export function validateCleanDatabaseMigration(migration) {
  const reviewedSql = stripSqlComments(migration)
  const statements = reviewedSql.match(/\bINSERT\s+INTO\b[\s\S]*?;/gi) ?? []
  const normalize = (statement) =>
    statement.trim().replaceAll(/\s+/g, " ").toLowerCase()
  const normalizedAllowed = [...allowedInitialStateRows].map(normalize).sort()
  const normalizedActual = statements.map(normalize).sort()
  const remainder = reviewedSql.replaceAll(/\bINSERT\s+INTO\b[\s\S]*?;/gi, "")
  const remainingStatements = remainder
    .split(";")
    .map((statement) => statement.trim().replaceAll(/\s+/g, " "))
    .filter(Boolean)
  const writesData = (statement) =>
    /^(?:update\b|delete\s+from\b|merge\s+into\b|truncate\b|copy\b|do\b|call\b)/i.test(
      statement,
    ) ||
    /^select\b[\s\S]*\binto\b/i.test(statement) ||
    /^with\b[\s\S]*\b(?:insert\s+into|update|delete\s+from|merge\s+into)\b/i.test(
      statement,
    ) ||
    /^create\s+(?:temporary\s+)?table\b[\s\S]*\bas\s+select\b/i.test(statement)
  if (
    JSON.stringify(normalizedActual) !== JSON.stringify(normalizedAllowed) ||
    /\bINSERT\s+INTO\b/i.test(remainder) ||
    remainingStatements.some(writesData)
  ) {
    fail("database seed contains an unapproved persisted row")
  }
  if (
    !/\bCREATE\s+TABLE\b/i.test(reviewedSql) ||
    !/\bCREATE\s+SCHEMA\s+common\b/i.test(reviewedSql) ||
    !/\bCREATE\s+SCHEMA\s+admin\b/i.test(reviewedSql)
  ) {
    fail("database seed does not contain the expected clean schema")
  }
  return statements
}

export function generateCleanSeedEvidence(
  outputRoot,
  { root = repositoryRoot } = {},
) {
  if (typeof outputRoot !== "string" || outputRoot.length === 0) {
    fail("outputRoot is required")
  }
  const identity = gitIdentity(root)
  const migrationPath = resolve(
    root,
    "infra/migrations/0000_inference_core.sql",
  )
  const migration = readFileSync(migrationPath, "utf8")
  const initialStateRows = validateCleanDatabaseMigration(migration)

  const artifacts = loadKeycloakArtifactsFromRoot(root)
  const validationErrors = [
    ...validateKeycloakSeed(artifacts.seed),
    ...validateCommissioningPlan(artifacts.commissioning),
    ...validateApplicationKeycloakSeed(artifacts.applicationSeed),
    ...validateApplicationCommissioningPlan(artifacts.applicationCommissioning),
    ...validateRealmIsolation(artifacts.seed, artifacts.applicationSeed),
  ]
  if (validationErrors.length > 0) {
    fail(`Keycloak seed source is invalid: ${validationErrors.join("; ")}`)
  }
  const documents = [
    ["humanRealm", artifacts.seed],
    ["humanCommissioning", artifacts.commissioning],
    ["applicationRealm", artifacts.applicationSeed],
    ["applicationCommissioning", artifacts.applicationCommissioning],
  ]
  for (const [name, document] of documents) {
    if (document?.metadata?.containsCredentials !== false) {
      fail(`${name} is not explicitly credential-free`)
    }
  }

  const databaseSeed = {
    schema: "llm-machines.clean-database-seed.v1",
    status: "PACKAGED_UNQUALIFIED",
    containsCredentials: false,
    containsCustomerData: false,
    initialStateRows,
    source: identity,
    migration: {
      path: "infra/migrations/0000_inference_core.sql",
      sha256: sha256(migration),
      sql: migration,
    },
  }
  const keycloakSeed = {
    schema: "llm-machines.clean-keycloak-seed.v1",
    status: "PACKAGED_UNQUALIFIED",
    containsCredentials: false,
    containsUsers: false,
    runtimeVersion: "26.7.0",
    source: identity,
    documents: Object.fromEntries(
      documents.map(([name, document]) => [
        name,
        { sha256: sha256(`${canonicalJson(document)}\n`), document },
      ]),
    ),
    commissioning: {
      oneTimeValuesGeneratedAtRuntime: true,
      nativeAdminConsoleCustomerAccess: false,
      grafanaCustomerAccess: "DEFERRED_V1",
    },
  }
  writeExclusiveJson(
    resolve(outputRoot, "seeds/clean-database-seed.json"),
    databaseSeed,
  )
  writeExclusiveJson(
    resolve(outputRoot, "seeds/clean-keycloak-seed.json"),
    keycloakSeed,
  )
  return {
    databaseSeedSha256: sha256(`${canonicalJson(databaseSeed)}\n`),
    keycloakSeedSha256: sha256(`${canonicalJson(keycloakSeed)}\n`),
    source: identity,
  }
}

export { canonicalJson }
