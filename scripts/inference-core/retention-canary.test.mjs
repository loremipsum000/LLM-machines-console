import assert from "node:assert/strict"
import { test } from "node:test"
import {
  characterizeSourceScenario,
  createRetentionCanarySet,
  requiredSourceArtifactClasses,
  requiredSourceScenarios,
  scanRetentionArtifacts,
  summarizeSourceCharacterization,
} from "./retention-canary.mjs"

test("source characterization reports clear only after the scenario was exercised", () => {
  const canaries = createRetentionCanarySet("clear-run")
  const result = characterizeSourceScenario({
    scenario: "non-stream-success",
    exercised: true,
    artifacts: {
      audit: {
        artifactClass: "managed-store",
        value: { appId: "app-1", tokens: 42 },
      },
      logs: { artifactClass: "log", value: "request completed" },
      usage: {
        artifactClass: "metric",
        value: { requests: 1, tokens: 42 },
      },
    },
    canaries,
  })

  assert.equal(result.verdict, "SOURCE_CANARY_CLEAR")
  assert.deepEqual(result.artifactClasses, ["log", "managed-store", "metric"])
  assert.equal(result.runtimeZeroRetentionCompliance, "NOT_EVALUATED")
  assert.equal(result.d2aRcRetentionEvidence, "NOT_DUE")
  assert.equal(
    summarizeSourceCharacterization([result]).verdict,
    "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE",
  )
})

test("artifact hits disclose only class, artifact, and a one-way fingerprint", () => {
  const canaries = createRetentionCanarySet("found-run")
  const hits = scanRetentionArtifacts({
    artifacts: {
      gateway: {
        artifactClass: "log",
        value: new Error(`accounting failed: ${canaries.upstream_error}`),
      },
    },
    canaries,
  })

  assert.equal(hits.length, 1)
  assert.equal(hits[0].artifact, "gateway")
  assert.equal(hits[0].artifactClass, "log")
  assert.equal(hits[0].canaryClass, "upstream_error")
  assert.equal(hits[0].canarySha256.length, 64)
  assert.equal(JSON.stringify(hits).includes(canaries.upstream_error), false)
})

test("structured containers cannot hide retained canaries", () => {
  const canaries = createRetentionCanarySet("container-run")
  const mapProperty = new Map()
  mapProperty.retained = canaries.tool_arguments
  const typedArrayProperty = new Uint8Array([1, 2, 3])
  typedArrayProperty.retained = canaries.tool_results
  for (const [name, value] of [
    ["map", new Map([["payload", canaries.prompt]])],
    ["set", new Set([canaries.model_response])],
    ["params", new URLSearchParams({ query: canaries.search_term })],
    ["bytes", Buffer.from(canaries.page_content)],
    ["nested-bytes", { payload: Buffer.from(canaries.extracted_content) }],
    ["map-property", mapProperty],
    ["typed-array-property", typedArrayProperty],
  ]) {
    const result = characterizeSourceScenario({
      scenario: "non-stream-success",
      exercised: true,
      artifacts: {
        [name]: { artifactClass: "managed-store", value },
      },
      canaries,
    })

    assert.equal(result.verdict, "SOURCE_CANARY_FOUND", name)
    assert.equal(result.hits.length, 1, name)
  }
})

test("function artifacts fail closed instead of ignoring attached content", () => {
  const canaries = createRetentionCanarySet("function-run")
  const artifact = () => undefined
  artifact.retained = canaries.prompt
  const result = characterizeSourceScenario({
    scenario: "non-stream-success",
    exercised: true,
    artifacts: {
      function: { artifactClass: "managed-store", value: artifact },
    },
    canaries,
  })

  assert.equal(result.verdict, "HARNESS_ERROR")
  assert.equal(result.errorClass, "TypeError")
})

test("incomplete source controls cannot be mislabeled as clear", () => {
  const canaries = createRetentionCanarySet("incomplete-run")
  const results = [
    characterizeSourceScenario({
      scenario: "timeout",
      exercised: false,
      controlAvailable: false,
      canaries,
    }),
    characterizeSourceScenario({
      scenario: "restart",
      exercised: false,
      runtimeRequired: true,
      canaries,
    }),
  ]

  assert.deepEqual(
    results.map((result) => result.verdict),
    ["SOURCE_CONTROL_ABSENT", "NOT_EVALUATED_RUNTIME"],
  )
  assert.equal(
    summarizeSourceCharacterization(results).verdict,
    "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE",
  )
})

test("a source canary hit fails the aggregate characterization", () => {
  const canaries = createRetentionCanarySet("aggregate-run")
  const clear = characterizeSourceScenario({
    scenario: "rejection",
    exercised: true,
    artifacts: {
      audit: {
        artifactClass: "managed-store",
        value: { outcome: "denied" },
      },
    },
    canaries,
  })
  const found = characterizeSourceScenario({
    scenario: "upstream-failure",
    exercised: true,
    artifacts: {
      logs: { artifactClass: "log", value: canaries.upstream_error },
    },
    canaries,
  })

  assert.equal(
    summarizeSourceCharacterization([clear, found]).verdict,
    "PR01_SOURCE_CHARACTERIZATION_FAILED",
  )
})

test("empty, unknown, and duplicate scenario sets cannot report clear", () => {
  const canaries = createRetentionCanarySet("scenario-contract-run")
  const duplicate = characterizeSourceScenario({
    scenario: "success",
    exercised: true,
    artifacts: {
      log: { artifactClass: "log", value: "clear" },
    },
    canaries,
  })
  const known = characterizeSourceScenario({
    scenario: "non-stream-success",
    exercised: true,
    artifacts: {
      log: { artifactClass: "log", value: "clear" },
    },
    canaries,
  })

  assert.equal(
    summarizeSourceCharacterization([]).verdict,
    "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE",
  )
  assert.equal(duplicate.verdict, "HARNESS_ERROR")
  assert.equal(
    summarizeSourceCharacterization([known, known]).verdict,
    "PR01_SOURCE_CHARACTERIZATION_FAILED",
  )
})

test("empty artifacts and partial canary sets are harness errors", () => {
  const canaries = createRetentionCanarySet("input-contract-run")
  const emptyArtifacts = characterizeSourceScenario({
    scenario: "non-stream-success",
    exercised: true,
    artifacts: {},
    canaries,
  })
  const partialCanaries = characterizeSourceScenario({
    scenario: "non-stream-success",
    exercised: true,
    artifacts: {
      log: { artifactClass: "log", value: "clear" },
    },
    canaries: { prompt: canaries.prompt },
  })

  assert.equal(emptyArtifacts.verdict, "HARNESS_ERROR")
  assert.equal(partialCanaries.verdict, "HARNESS_ERROR")
})

test("complete scenarios still require every artifact class", () => {
  const canaries = createRetentionCanarySet("artifact-coverage-run")
  const results = requiredSourceScenarios.map((scenario) =>
    characterizeSourceScenario({
      scenario,
      exercised: true,
      artifacts: {
        log: { artifactClass: "log", value: { scenario } },
      },
      canaries,
    }),
  )
  const summary = summarizeSourceCharacterization(results)

  assert.equal(summary.verdict, "PR01_SOURCE_CHARACTERIZATION_INCOMPLETE")
  assert.deepEqual(
    summary.missingArtifactClasses,
    requiredSourceArtifactClasses.filter(
      (artifactClass) => artifactClass !== "log",
    ),
  )
})

test("only the exact scenario and artifact contract can report source clear", () => {
  const canaries = createRetentionCanarySet("complete-contract-run")
  const results = requiredSourceScenarios.map((scenario, index) =>
    characterizeSourceScenario({
      scenario,
      exercised: true,
      artifacts: {
        [scenario]: {
          artifactClass:
            requiredSourceArtifactClasses[
              index % requiredSourceArtifactClasses.length
            ],
          value: { scenario, retained: false },
        },
      },
      canaries,
    }),
  )
  const summary = summarizeSourceCharacterization(results)

  assert.equal(summary.verdict, "PR01_SOURCE_CHARACTERIZATION_CLEAR")
  assert.equal(summary.scenarioCount, requiredSourceScenarios.length)
  assert.equal(summary.artifactClassCount, requiredSourceArtifactClasses.length)
  assert.deepEqual(summary.missingScenarios, [])
  assert.deepEqual(summary.missingArtifactClasses, [])
  assert.equal(summary.runtimeZeroRetentionCompliance, "NOT_EVALUATED")

  const forged = results.map((result) => ({
    ...result,
    hits: [
      {
        artifact: "forged",
        artifactClass: "log",
        canaryClass: "prompt",
        canarySha256: "0".repeat(64),
      },
    ],
  }))
  assert.equal(
    summarizeSourceCharacterization(forged).verdict,
    "PR01_SOURCE_CHARACTERIZATION_FAILED",
  )
})
