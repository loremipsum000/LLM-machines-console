import { describe, expect, it } from "vitest"
import { inferenceCoreAlertNames } from "./inference-core"

describe("Inference Core alert vocabulary", () => {
  it("exports the exact ordered canonical alert names", () => {
    expect(inferenceCoreAlertNames).toEqual([
      "LLMMGpuSaturation",
      "LLMMInferenceFailureRatioHigh",
      "LLMMInferenceQueueDepthPersisting",
      "LLMMInferenceQueueDepthSignalMissing",
    ])
    expect(new Set(inferenceCoreAlertNames).size).toBe(
      inferenceCoreAlertNames.length,
    )
    expect(
      inferenceCoreAlertNames.every((name) =>
        /^[A-Za-z][A-Za-z0-9]{0,127}$/.test(name),
      ),
    ).toBe(true)
    expect(Object.isFrozen(inferenceCoreAlertNames)).toBe(true)
  })
})
