import type {
  LifecycleComponent,
  LifecycleSnapshotComponent,
} from "@llm-machines/contracts"
import { describe, expect, it, vi } from "vitest"
import {
  LifecycleAdapterError,
  type LifecycleComponentDriver,
  type LifecycleComponentDriverMap,
  createLifecycleComponentAdapters,
} from "./lifecycle-component-adapters"

const operationContext = {
  operationId: "11111111-1111-4111-8111-111111111111",
  operationKind: "restore" as const,
}

describe("retained lifecycle component adapters", () => {
  it("binds exactly the retained components in consistency-point order", () => {
    const adapters = createLifecycleComponentAdapters(driverMap())
    expect(adapters.map(({ component }) => component)).toEqual([
      "console_database",
      "keycloak",
      "litellm",
      "grafana",
    ])
  })

  it("accepts only a staged preparation with rollback capability and no active mutation", async () => {
    const drivers = driverMap()
    const unsafe = drivers.keycloak
    unsafe.prepareRestore = vi.fn(async () => ({
      activeStateMutated: true,
      component: "keycloak",
      preparationId: "unsafe",
      rollbackCapability: "established",
    })) as LifecycleComponentDriver["prepareRestore"]
    const keycloak = createLifecycleComponentAdapters(drivers)[1]

    await expect(
      keycloak.prepareRestore(captures.keycloak, operationContext),
    ).rejects.toMatchObject({
      component: "keycloak",
      method: "prepare_restore",
      name: "LifecycleAdapterError",
    })
  })

  it("rejects cross-component captures and redacts driver failures", async () => {
    const drivers = driverMap()
    drivers.litellm.capture = vi.fn(async () => {
      throw new Error("private-runtime-address")
    })
    const adapters = createLifecycleComponentAdapters(drivers)

    await expect(
      adapters[0].validateCapture(captures.keycloak, operationContext),
    ).rejects.toBeInstanceOf(LifecycleAdapterError)
    const failure = await adapters[2]
      .capture(operationContext)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LifecycleAdapterError)
    expect(JSON.stringify(failure)).not.toContain("private-runtime-address")
  })

  it("bounds staged-preparation discard failures", async () => {
    const drivers = driverMap()
    drivers.grafana.discardRestorePreparation = vi.fn(async () => {
      throw new Error("private-runtime-address")
    })
    const grafana = createLifecycleComponentAdapters(drivers)[3]
    const preparation = await grafana.prepareRestore(
      captures.grafana,
      operationContext,
    )

    const failure = await grafana
      .discardRestorePreparation(preparation, operationContext)
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({
      component: "grafana",
      method: "discard_restore_preparation",
      name: "LifecycleAdapterError",
    })
    expect(JSON.stringify(failure)).not.toContain("private-runtime-address")
  })
})

function driverMap(): LifecycleComponentDriverMap {
  return {
    console_database: driver("console_database"),
    keycloak: driver("keycloak"),
    litellm: driver("litellm"),
    grafana: driver("grafana"),
  }
}

function driver(component: LifecycleComponent): LifecycleComponentDriver {
  return {
    capture: vi.fn(async () => captures[component]),
    prepareRestore: vi.fn(async () => ({
      activeStateMutated: false as const,
      component,
      preparationId: `${component}-preparation`,
      rollbackCapability: "established" as const,
    })),
    discardRestorePreparation: vi.fn(async () => undefined),
    quiesce: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    rollbackRestore: vi.fn(async () => undefined),
    validateCapture: vi.fn(async () => undefined),
    validateRestore: vi.fn(async () => undefined),
  }
}

const captures: Record<LifecycleComponent, LifecycleSnapshotComponent> = {
  console_database: {
    component: "console_database",
    ordinal: 0,
    revision: "db-1",
    artifactSha256: "0".repeat(64),
  },
  keycloak: {
    component: "keycloak",
    ordinal: 1,
    revision: "kc-1",
    artifactSha256: "1".repeat(64),
  },
  litellm: {
    component: "litellm",
    ordinal: 2,
    revision: "llm-1",
    artifactSha256: "2".repeat(64),
  },
  grafana: {
    component: "grafana",
    ordinal: 3,
    revision: "grafana-1",
    artifactSha256: "3".repeat(64),
  },
}
