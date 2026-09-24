// npx vitest run core/assistant-message/__tests__/presentAssistantMessage-partial-tool-ask.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { presentAssistantMessage } from "../presentAssistantMessage"
import { Task } from "../../task/Task"
import type { ToolCallbacks } from "../../tools/BaseTool"
import { writeToFileTool } from "../../tools/WriteToFileTool"
import { applyDiffTool } from "../../tools/ApplyDiffTool"
import { useMcpToolTool } from "../../tools/UseMcpToolTool"

vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("../../tools/WriteToFileTool", () => ({ writeToFileTool: { handle: vi.fn() } }))
vi.mock("../../tools/ApplyDiffTool", () => ({ applyDiffTool: { handle: vi.fn() } }))
vi.mock("../../tools/UseMcpToolTool", () => ({ useMcpToolTool: { handle: vi.fn() } }))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: { captureToolUsage: vi.fn(), captureConsecutiveMistakeError: vi.fn(), captureEvent: vi.fn() },
	},
}))

// Only EditFileTool finalizes its own streaming preview. Every other tool that fails
// after streaming one relies on presentAssistantMessage's handleError to stop its spinner.

type ToolHandle = (task: unknown, block: unknown, callbacks: ToolCallbacks) => Promise<void>

function createTask() {
	const clineMessages: ClineMessage[] = []
	const task = {
		taskId: "test-task-id",
		instanceId: "test-instance",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		currentStreamingDidCheckpoint: true,
		assistantMessageContent: [] as unknown[],
		userMessageContent: [] as unknown[],
		didCompleteReadingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		clineMessages,
		getTaskMode: vi.fn().mockResolvedValue("code"),
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [], experiments: {} }),
				getMcpHub: () => undefined,
			}),
		},
		say: vi.fn(async (type: string, text?: string) => {
			clineMessages.push({ ts: clineMessages.length + 1, type: "say", say: type as ClineMessage["say"], text })
		}),
		// Mirrors Task.ask for a partial preview: the preview row is appended still partial.
		ask: vi.fn(async (type: string, text?: string, partial?: boolean) => {
			if (partial) {
				clineMessages.push({
					ts: clineMessages.length + 1,
					type: "ask",
					ask: type as ClineMessage["ask"],
					text,
					partial,
				})
			}
			return { response: "yesButtonClicked" }
		}),
		pushToolResultToUserContent: vi.fn(() => true),
		saveClineMessages: vi.fn().mockResolvedValue(true),
		updateClineMessage: vi.fn().mockResolvedValue(undefined),
		finalizePartialToolAsk: Task.prototype.finalizePartialToolAsk,
	}
	return task
}

// presentAssistantMessage takes a full Task; the double cast keeps the double structural
// rather than instantiating Task, which needs a provider, API handler and storage.
const run = (task: ReturnType<typeof createTask>) => presentAssistantMessage(task as unknown as Task)

function streamPreviewThenFail(handle: ToolHandle, preview: string) {
	vi.mocked(handle).mockImplementation(async (task, _block, callbacks) => {
		await (task as ReturnType<typeof createTask>).ask("tool", preview, true)
		await callbacks.handleError("writing file", new Error("Failed to open diff editor"))
	})
}

describe("presentAssistantMessage - partial tool ask on tool error", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each([
		["write_to_file", writeToFileTool.handle, { path: "a.ts", content: "x" }],
		["apply_diff", applyDiffTool.handle, { path: "a.ts", diff: "x" }],
		["use_mcp_tool", useMcpToolTool.handle, { server_name: "s", tool_name: "t", arguments: "{}" }],
	] as const)("stops the spinner of a %s preview when the tool fails", async (name, handle, nativeArgs) => {
		const task = createTask()
		streamPreviewThenFail(handle as ToolHandle, `{"tool":"${name}"}`)
		task.assistantMessageContent = [
			{ type: "tool_use", id: "call_1", name, params: {}, nativeArgs, partial: false },
		]

		await run(task)

		const preview = task.clineMessages.find((message) => message.type === "ask")
		expect(preview).toMatchObject({ partial: false, isAnswered: true })
		expect(preview?.progressStatus).toBeUndefined()
		expect(task.saveClineMessages).toHaveBeenCalled()
		expect(task.updateClineMessage).toHaveBeenCalledWith(preview)
		// Finalized before the error row, so the webview never shows both a spinner and the error.
		expect(task.updateClineMessage.mock.invocationCallOrder[0]).toBeLessThan(
			task.say.mock.invocationCallOrder[task.say.mock.calls.findIndex(([type]) => type === "error")],
		)
	})

	it("stops the spinner of a native mcp_tool_use preview when the tool fails", async () => {
		const task = createTask()
		streamPreviewThenFail(useMcpToolTool.handle as ToolHandle, '{"tool":"use_mcp_tool"}')
		task.assistantMessageContent = [
			{
				type: "mcp_tool_use",
				id: "call_1",
				name: "mcp_s_t",
				serverName: "s",
				toolName: "t",
				arguments: {},
				partial: false,
			},
		]

		await run(task)

		expect(task.clineMessages.find((message) => message.type === "ask")).toMatchObject({
			partial: false,
			isAnswered: true,
		})
	})

	it("leaves the messages alone when the failing tool streamed no preview", async () => {
		const task = createTask()
		vi.mocked(writeToFileTool.handle).mockImplementation(async (_task, _block, callbacks) => {
			await callbacks.handleError("writing file", new Error("boom"))
		})
		task.assistantMessageContent = [
			{
				type: "tool_use",
				id: "call_1",
				name: "write_to_file",
				params: {},
				nativeArgs: { path: "a", content: "" },
				partial: false,
			},
		]

		await run(task)

		expect(task.updateClineMessage).not.toHaveBeenCalled()
		expect(task.clineMessages).toEqual([expect.objectContaining({ type: "say", say: "error" })])
	})
})
