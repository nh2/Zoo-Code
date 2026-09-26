// Covers the Bedrock stream events that used to be discarded silently:
// `messageStop.stopReason` (now a diagnostic chunk) and the in-band exception events
// (now thrown). A stream ending with zero content is otherwise indistinguishable from
// a truncated, filtered or rejected turn.

const mockCaptureException = vi.fn()

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

vi.mock("@aws-sdk/credential-providers", () => ({
	fromIni: vi.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	}),
}))

vi.mock("../../../utils/networkProxy", () => ({
	getSystemProxyUrl: vi.fn().mockReturnValue(undefined),
}))

vi.mock("@smithy/node-http-handler", () => ({ NodeHttpHandler: vi.fn() }))
vi.mock("http-proxy-agent", () => ({ HttpProxyAgent: vi.fn() }))
vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent: vi.fn() }))

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn().mockImplementation(function () {
		return { send: vi.fn() }
	}),
	ConverseStreamCommand: vi.fn(),
	ConverseCommand: vi.fn(),
}))

import type { Anthropic } from "@anthropic-ai/sdk"

import { AwsBedrockHandler, BEDROCK_STREAM_EXCEPTION_KEYS } from "../bedrock"
import { OutputTokenLimitError } from "../utils/output-token-limit-error"
import type { ApiStreamChunk } from "../../transform/stream"
import { makeCreateMessageMetadata, makeRecordingRawApiDump } from "../../../test-utils/api"
import { clearAllMocks } from "../../../test-utils/reset"

const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

function createHandler(streamEvents: unknown[]): AwsBedrockHandler {
	const handler = new AwsBedrockHandler({
		apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
		awsAccessKey: "test-access-key",
		awsSecretKey: "test-secret-key",
		awsRegion: "us-east-1",
	})
	handler["client"].send = vi.fn().mockResolvedValue({ stream: streamEvents })
	return handler
}

async function collect(handler: AwsBedrockHandler): Promise<ApiStreamChunk[]> {
	const chunks: ApiStreamChunk[] = []
	for await (const chunk of handler.createMessage("system", messages, makeCreateMessageMetadata())) {
		chunks.push(chunk)
	}
	return chunks
}

describe("AwsBedrockHandler stream diagnostics", () => {
	beforeEach(() => {
		clearAllMocks()
	})

	describe("messageStop.stopReason", () => {
		it("surfaces the stop reason as a dedicated chunk before reporting truncation", async () => {
			const handler = createHandler([
				{ contentBlockDelta: { delta: { text: "partial" } } },
				{ messageStop: { stopReason: "max_tokens" } },
			])
			const chunks: ApiStreamChunk[] = []

			await expect(
				(async () => {
					for await (const chunk of handler.createMessage("system", messages, makeCreateMessageMetadata())) {
						chunks.push(chunk)
					}
				})(),
			).rejects.toBeInstanceOf(OutputTokenLimitError)

			expect(chunks).toEqual([
				{ type: "text", text: "partial" },
				{ type: "stop_reason", reason: "max_tokens" },
			])
		})

		it.each(["guardrail_intervened", "content_filtered", "malformed_tool_use"])(
			"reports %s even when the turn carried no content at all",
			async (stopReason) => {
				const chunks = await collect(
					createHandler([
						{ messageStop: { stopReason } },
						{ metadata: { usage: { inputTokens: 1200, outputTokens: 0 } } },
					]),
				)

				expect(chunks).toContainEqual({ type: "stop_reason", reason: stopReason })
				// It must not masquerade as assistant content.
				expect(chunks.some((chunk) => chunk.type === "text")).toBe(false)
			},
		)

		it("emits no stop_reason chunk when the provider omits the reason", async () => {
			const chunks = await collect(createHandler([{ messageStop: {} }]))

			expect(chunks).toEqual([])
		})
	})

	describe("in-band exception events", () => {
		it.each(BEDROCK_STREAM_EXCEPTION_KEYS)("throws on a %s event instead of dropping it", async (key) => {
			const handler = createHandler([{ [key]: { message: "provider complaint text" } }])

			// The provider's own sentence is what the reporting path renders for the user.
			await expect(collect(handler)).rejects.toThrow(/provider complaint text/)
		})

		it("reports the exception to telemetry with the provider message", async () => {
			const handler = createHandler([
				{ validationException: { message: "The toolResult blocks contain duplicate Ids: tooluse_abc" } },
			])

			await expect(collect(handler)).rejects.toThrow()

			expect(mockCaptureException).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("duplicate Ids: tooluse_abc"),
				}),
			)
		})

		it("still throws when the exception event carries no message", async () => {
			const handler = createHandler([{ internalServerException: {} }])

			await expect(collect(handler)).rejects.toThrow(/internalServerException/)
		})

		it("does not abort the stream for an unmodelled event", async () => {
			// Only genuine exception events may throw; an event this SDK version does not
			// model falls through and must leave a working stream intact.
			const chunks = await collect(
				createHandler([
					{ $unknown: ["someFutureEvent", { detail: "ignored" }] },
					{ contentBlockDelta: { delta: { text: "still works" } } },
					{ messageStop: { stopReason: "end_turn" } },
				]),
			)

			expect(chunks).toEqual([
				{ type: "text", text: "still works" },
				{ type: "stop_reason", reason: "end_turn" },
			])
		})
	})

	describe("raw API dump", () => {
		it("records the request payload and every stream event before normalisation", async () => {
			// An empty reasoning block and a bare signature delta both yield no chunk.
			const events = [
				{ contentBlockStart: { contentBlockIndex: 0, start: { reasoningContent: {} } } },
				{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig" } } } },
				{ contentBlockDelta: { contentBlockIndex: 1, delta: { text: "hi" } } },
				{ messageStop: { stopReason: "end_turn" } },
			]
			const rawApiDump = makeRecordingRawApiDump()
			const handler = createHandler(events)

			const chunks: ApiStreamChunk[] = []
			for await (const chunk of handler.createMessage(
				"system",
				messages,
				makeCreateMessageMetadata({ rawApiDump }),
			)) {
				chunks.push(chunk)
			}

			expect(chunks.filter((c) => c.type === "text")).toEqual([{ type: "text", text: "hi" }])
			expect(rawApiDump.records[0]).toMatchObject({
				provider: "Bedrock",
				kind: "request",
				data: expect.objectContaining({ modelId: expect.any(String), messages: expect.any(Array) }),
			})
			expect(rawApiDump.records.slice(1)).toEqual(
				events.map((data) => ({ provider: "Bedrock", kind: "event", data })),
			)
		})

		it("records stream errors", async () => {
			const rawApiDump = makeRecordingRawApiDump()
			const handler = createHandler([{ validationException: { message: "bad" } }])

			await expect(
				(async () => {
					for await (const _ of handler.createMessage(
						"system",
						messages,
						makeCreateMessageMetadata({ rawApiDump }),
					)) {
						// drain
					}
				})(),
			).rejects.toThrow()

			expect(rawApiDump.records.at(-1)).toMatchObject({
				kind: "error",
				data: expect.objectContaining({ message: expect.stringContaining("bad") }),
			})
		})
	})
})
