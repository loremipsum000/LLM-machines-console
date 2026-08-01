import {
  type LifecycleComponent,
  type LifecycleOperationKind,
  type LifecycleSnapshotComponent,
  lifecycleComponentSchema,
  lifecycleOperationKindSchema,
  lifecycleSnapshotComponentSchema,
} from "@llm-machines/contracts"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const safeOpaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

export type LifecycleAdapterMethod =
  | "capture"
  | "discard_restore_preparation"
  | "prepare_restore"
  | "quiesce"
  | "restore"
  | "resume"
  | "rollback_restore"
  | "validate_capture"
  | "validate_restore"

export class LifecycleAdapterError extends Error {
  constructor(
    readonly component: LifecycleComponent,
    readonly method: LifecycleAdapterMethod,
  ) {
    super(`Lifecycle component adapter failed: ${component}:${method}.`)
    this.name = "LifecycleAdapterError"
  }
}

export interface LifecycleAdapterContext {
  operationId: string
  operationKind: LifecycleOperationKind
}

export interface LifecyclePreparedRestore {
  activeStateMutated: false
  component: LifecycleComponent
  preparationId: string
  rollbackCapability: "established"
}

export interface LifecycleComponentDriver {
  capture(context: LifecycleAdapterContext): Promise<LifecycleSnapshotComponent>
  /**
   * Must be failure-atomic: rejection or an invalid result leaves no staged
   * material behind and never mutates active state.
   */
  prepareRestore(
    capture: LifecycleSnapshotComponent,
    context: LifecycleAdapterContext,
  ): Promise<LifecyclePreparedRestore>
  /**
   * Releases staged source material without mutating active component state.
   * For an attempted restore, the established rollback capability remains
   * usable until the lifecycle operation reaches a terminal state.
   */
  discardRestorePreparation(
    preparation: LifecyclePreparedRestore,
    context: LifecycleAdapterContext,
  ): Promise<void>
  /** Must be safe to pair with resume even when quiesce reports failure. */
  quiesce(context: LifecycleAdapterContext): Promise<void>
  restore(
    preparation: LifecyclePreparedRestore,
    context: LifecycleAdapterContext,
  ): Promise<void>
  resume(context: LifecycleAdapterContext): Promise<void>
  /** Must compensate an attempted restore, including an unknown partial write. */
  rollbackRestore(
    preparation: LifecyclePreparedRestore,
    context: LifecycleAdapterContext,
  ): Promise<void>
  validateCapture(
    capture: LifecycleSnapshotComponent,
    context: LifecycleAdapterContext,
  ): Promise<void>
  validateRestore(
    capture: LifecycleSnapshotComponent,
    context: LifecycleAdapterContext,
  ): Promise<void>
}

export type LifecycleComponentDriverMap = Readonly<
  Record<LifecycleComponent, LifecycleComponentDriver>
>

export interface LifecycleComponentAdapter extends LifecycleComponentDriver {
  readonly component: LifecycleComponent
}

export type LifecycleComponentAdapters = readonly [
  LifecycleComponentAdapter,
  LifecycleComponentAdapter,
  LifecycleComponentAdapter,
  LifecycleComponentAdapter,
]

/**
 * Binds retained components to injected drivers only. Runtime connection and
 * deployment configuration stay outside this source boundary.
 */
export function createLifecycleComponentAdapters(
  drivers: LifecycleComponentDriverMap,
): LifecycleComponentAdapters {
  return [
    retainedAdapter("console_database", drivers.console_database),
    retainedAdapter("keycloak", drivers.keycloak),
    retainedAdapter("litellm", drivers.litellm),
    retainedAdapter("grafana", drivers.grafana),
  ]
}

function retainedAdapter(
  component: LifecycleComponent,
  driver: LifecycleComponentDriver,
): LifecycleComponentAdapter {
  if (!driver || !lifecycleComponentSchema.safeParse(component).success) {
    throw new LifecycleAdapterError(component, "prepare_restore")
  }

  return {
    component,
    capture: async (context) => {
      assertContext(component, context, "capture")
      try {
        const capture = await driver.capture(context)
        const parsed = lifecycleSnapshotComponentSchema.safeParse(capture)
        if (!parsed.success || parsed.data.component !== component) {
          throw new Error("Invalid capture projection.")
        }
        return parsed.data
      } catch {
        throw new LifecycleAdapterError(component, "capture")
      }
    },
    prepareRestore: async (capture, context) => {
      assertContext(component, context, "prepare_restore")
      assertCapture(component, capture, "prepare_restore")
      try {
        const preparation = await driver.prepareRestore(capture, context)
        if (!validPreparation(component, preparation)) {
          throw new Error("Unsafe restore preparation.")
        }
        return {
          activeStateMutated: false,
          component,
          preparationId: preparation.preparationId,
          rollbackCapability: "established",
        }
      } catch {
        throw new LifecycleAdapterError(component, "prepare_restore")
      }
    },
    discardRestorePreparation: async (preparation, context) => {
      assertContext(component, context, "discard_restore_preparation")
      if (!validPreparation(component, preparation)) {
        throw new LifecycleAdapterError(
          component,
          "discard_restore_preparation",
        )
      }
      await boundedCall(component, "discard_restore_preparation", () =>
        driver.discardRestorePreparation(preparation, context),
      )
    },
    quiesce: async (context) => {
      assertContext(component, context, "quiesce")
      await boundedCall(component, "quiesce", () => driver.quiesce(context))
    },
    restore: async (preparation, context) => {
      assertContext(component, context, "restore")
      if (!validPreparation(component, preparation)) {
        throw new LifecycleAdapterError(component, "restore")
      }
      await boundedCall(component, "restore", () =>
        driver.restore(preparation, context),
      )
    },
    resume: async (context) => {
      assertContext(component, context, "resume")
      await boundedCall(component, "resume", () => driver.resume(context))
    },
    rollbackRestore: async (preparation, context) => {
      assertContext(component, context, "rollback_restore")
      if (!validPreparation(component, preparation)) {
        throw new LifecycleAdapterError(component, "rollback_restore")
      }
      await boundedCall(component, "rollback_restore", () =>
        driver.rollbackRestore(preparation, context),
      )
    },
    validateCapture: async (capture, context) => {
      assertContext(component, context, "validate_capture")
      assertCapture(component, capture, "validate_capture")
      await boundedCall(component, "validate_capture", () =>
        driver.validateCapture(capture, context),
      )
    },
    validateRestore: async (capture, context) => {
      assertContext(component, context, "validate_restore")
      assertCapture(component, capture, "validate_restore")
      await boundedCall(component, "validate_restore", () =>
        driver.validateRestore(capture, context),
      )
    },
  }
}

function assertContext(
  component: LifecycleComponent,
  context: LifecycleAdapterContext,
  method: LifecycleAdapterMethod,
): void {
  if (
    !uuidPattern.test(context.operationId) ||
    !lifecycleOperationKindSchema.safeParse(context.operationKind).success
  ) {
    throw new LifecycleAdapterError(component, method)
  }
}

function assertCapture(
  component: LifecycleComponent,
  capture: LifecycleSnapshotComponent,
  method: LifecycleAdapterMethod,
): void {
  const parsed = lifecycleSnapshotComponentSchema.safeParse(capture)
  if (!parsed.success || parsed.data.component !== component) {
    throw new LifecycleAdapterError(component, method)
  }
}

function validPreparation(
  component: LifecycleComponent,
  value: LifecyclePreparedRestore,
): boolean {
  return (
    value?.component === component &&
    value.activeStateMutated === false &&
    value.rollbackCapability === "established" &&
    typeof value.preparationId === "string" &&
    safeOpaqueIdPattern.test(value.preparationId)
  )
}

async function boundedCall(
  component: LifecycleComponent,
  method: LifecycleAdapterMethod,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run()
  } catch {
    throw new LifecycleAdapterError(component, method)
  }
}
