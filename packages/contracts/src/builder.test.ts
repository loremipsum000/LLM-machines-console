import { describe, expect, it } from "vitest"
import {
  builderResourceSchema,
  builderAgentStudioSchema,
  builderAgentTestResultSchema,
  builderAgentTestStreamEventSchema,
  builderSubmissionSchema,
  builderTemplateSchema,
} from "./builder"

describe("builder contracts", () => {
  it("parses a starter template", () => {
    expect(
      builderTemplateSchema.parse({
        id: "template-summary-agent",
        type: "agent",
        name: "Summary Agent",
        description: "Summarizes selected context for a user.",
        category: "Agent",
        version: "0.1.0",
        supportTier: "t1",
        tags: ["agent", "summary"],
        samplePrompts: ["Summarize this incident report."],
        href: "/builder/templates/template-summary-agent",
        forkHref: "/builder/templates/template-summary-agent/fork",
      }),
    ).toMatchObject({
      id: "template-summary-agent",
      type: "agent",
    })
  })

  it("parses a builder resource with an immutable current version", () => {
    expect(
      builderResourceSchema.parse({
        id: "66666666-6666-4666-8666-666666666666",
        type: "agent",
        name: "Summary Agent",
        description: "Draft summary agent built from a starter template.",
        ownerId: "builder-1",
        ownerName: "Builder One",
        state: "draft",
        templateId: "template-summary-agent",
        currentVersion: {
          id: "77777777-7777-4777-8777-777777777777",
          semver: "v0.1",
          createdAt: "2026-05-21T08:00:00.000Z",
        },
        updatedAt: "2026-05-21T08:20:00.000Z",
        href: "/builder/resources/66666666-6666-4666-8666-666666666666",
        editorHref: "/builder/agents/66666666-6666-4666-8666-666666666666",
      }),
    ).toMatchObject({
      state: "draft",
      currentVersion: {
        semver: "v0.1",
      },
    })
  })

  it("keeps rejection as a submission state, not a published resource state", () => {
    expect(
      builderSubmissionSchema.parse({
        id: "88888888-8888-4888-8888-888888888888",
        resourceId: "66666666-6666-4666-8666-666666666666",
        resourceName: "Summary Agent",
        resourceType: "agent",
        submittedVersion: "v0.1",
        state: "rejected",
        adminComment: "Add a narrower system prompt before publishing.",
        submittedAt: "2026-05-21T08:25:00.000Z",
        decidedAt: "2026-05-21T08:40:00.000Z",
        href: "/builder/submissions/88888888-8888-4888-8888-888888888888",
      }),
    ).toMatchObject({
      state: "rejected",
      adminComment: "Add a narrower system prompt before publishing.",
    })
  })

  it("keeps withdrawal as a submission state, not a resource state", () => {
    expect(
      builderSubmissionSchema.parse({
        id: "99999999-9999-4999-8999-999999999999",
        resourceId: "66666666-6666-4666-8666-666666666666",
        resourceName: "Summary Agent",
        resourceType: "agent",
        submittedVersion: "v0.2",
        state: "withdrawn",
        adminComment: null,
        submittedAt: "2026-05-21T08:25:00.000Z",
        decidedAt: "2026-05-21T08:40:00.000Z",
        href: "/builder/submissions/99999999-9999-4999-8999-999999999999",
      }),
    ).toMatchObject({
      state: "withdrawn",
      adminComment: null,
    })
  })

  it("parses a form-view Builder Agent Studio model", () => {
    expect(
      builderAgentStudioSchema.parse({
        resource: {
          id: "66666666-6666-4666-8666-666666666666",
          type: "agent",
          name: "Summary Agent",
          description: "Draft summary agent.",
          ownerId: "builder-1",
          ownerName: "Builder One",
          state: "draft",
          templateId: "template-summary-agent",
          currentVersion: null,
          updatedAt: "2026-05-21T08:20:00.000Z",
          href: "/builder/resources/66666666-6666-4666-8666-666666666666",
          editorHref: "/builder/agents/66666666-6666-4666-8666-666666666666",
        },
        config: {
          resourceId: "66666666-6666-4666-8666-666666666666",
          model: "qwen3-35b-local",
          sandboxProfile: "openclaw-restricted",
          systemPrompt: "You summarize internal context.",
          instructions: "Return a concise summary and next actions.",
          temperature: 0.2,
          maxOutputTokens: 1024,
          tools: [],
          sampleInput: "Summarize this incident.",
          updatedAt: "2026-05-21T08:20:00.000Z",
        },
        editable: true,
        testable: true,
        quota: {
          period: "daily",
          timezone: "UTC",
          status: "ok",
          enforced: true,
          usedRuns: 2,
          runLimit: 20,
          remainingRuns: 18,
          usedTokens: 1200,
          tokenLimit: 10000,
          remainingTokens: 8800,
          resetsAt: "2026-05-22T00:00:00.000Z",
        },
        recentTestRuns: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            resourceId: "66666666-6666-4666-8666-666666666666",
            input: "Summarize this incident.",
            output: "Summary Agent preview output.",
            source: "local_preview",
            status: "succeeded",
            model: "qwen3-35b-local",
            sandboxProfile: "openclaw-restricted",
            durationMs: 120,
            runtimeTraceId: "trace-99999999",
            finishReason: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            errorDetail: null,
            trace: [
              {
                at: "2026-05-21T08:20:00.000Z",
                label: "Runtime dispatch",
                status: "succeeded",
                detail: "Local preview completed.",
              },
            ],
            createdAt: "2026-05-21T08:20:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      resource: {
        type: "agent",
      },
      editable: true,
    })
  })

  it("parses Builder Agent Studio test results", () => {
    expect(
      builderAgentTestResultSchema.parse({
        id: "99999999-9999-4999-8999-999999999999",
        resourceId: "66666666-6666-4666-8666-666666666666",
        input: "Summarize this incident.",
        output: "Summary Agent preview output.",
        source: "local_preview",
        status: "succeeded",
        model: "qwen3-35b-local",
        sandboxProfile: "openclaw-restricted",
        durationMs: 120,
        runtimeTraceId: "trace-99999999",
        finishReason: "stop",
        promptTokens: 18,
        completionTokens: 42,
        totalTokens: 60,
        errorDetail: null,
        trace: [
          {
            at: "2026-05-21T08:20:00.000Z",
            label: "Runtime dispatch",
            status: "succeeded",
            detail: "Runtime completed.",
          },
        ],
        toolCalls: [
          {
            at: "2026-05-21T08:20:01.000Z",
            id: "call_1",
            index: 0,
            name: "hub.search",
            status: "requested",
            argumentsPreview: '{"query":"incident"}',
          },
        ],
        createdAt: "2026-05-21T08:20:00.000Z",
        quota: {
          period: "daily",
          timezone: "UTC",
          status: "unlimited",
          enforced: false,
          usedRuns: 1,
          runLimit: null,
          remainingRuns: null,
          usedTokens: 60,
          tokenLimit: null,
          remainingTokens: null,
          resetsAt: "2026-05-22T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      source: "local_preview",
      status: "succeeded",
      toolCalls: [
        expect.objectContaining({
          name: "hub.search",
        }),
      ],
    })
  })

  it("parses Builder Agent Studio stream events", () => {
    expect(
      builderAgentTestStreamEventSchema.parse({
        type: "builder.agent_test.delta",
        testRunId: "99999999-9999-4999-8999-999999999999",
        runtimeTraceId: "trace-99999999",
        delta: "Streaming output.",
      }),
    ).toMatchObject({
      type: "builder.agent_test.delta",
      delta: "Streaming output.",
    })
    expect(
      builderAgentTestStreamEventSchema.parse({
        type: "builder.agent_test.tool_call",
        testRunId: "99999999-9999-4999-8999-999999999999",
        runtimeTraceId: "trace-99999999",
        toolCall: {
          at: "2026-05-21T08:20:01.000Z",
          id: "call_1",
          index: 0,
          name: "hub.search",
          status: "requested",
          argumentsPreview: '{"query":"incident"}',
        },
      }),
    ).toMatchObject({
      type: "builder.agent_test.tool_call",
      toolCall: {
        name: "hub.search",
      },
    })
  })
})
