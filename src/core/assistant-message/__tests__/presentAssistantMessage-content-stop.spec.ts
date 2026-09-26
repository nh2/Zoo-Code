// npx vitest run core/assistant-message/__tests__/presentAssistantMessage-content-stop.spec.ts

import { presentAssistantMessage } from "../presentAssistantMessage"

const mockExecuteCommandHandle = vi.hoisted(() => vi.fn())
const mockUseMcpToolHandle = vi.hoisted(() => vi.fn())

vi.mock("../../task/Task")
vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))
vi.mock("../../tools/ExecuteCommandTool", () => ({
	executeCommandTool: { handle: mockExecuteCommandHandle },
}))
vi.mock("../../tools/UseMcpToolTool", () => ({
	useMcpToolTool: { handle: mockUseMcpToolHandle },
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureToolUsage: vi.fn(),
			captureConsecutiveMistakeError: vi.fn(),
		},
	},
}))

// The truncated call from the #1820 report: Bedrock closed the open JSON string after the filter cut it off.
const truncatedCommand =
	"cd /etc/nixos && nix-instantiate --eval --strict -E '\nlet s = import <nixpkgs/nixos> {};\n    off = c.specialisation.\"intel-nvid"

type TestToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

function makeTask(contentStopReason: string | undefined, block: Record<string, unknown>) {
	const userMessageContent: TestToolResult[] = []
	return {
		taskId: "test-task-id",
		instanceId: "test-instance",
		abort: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [block],
		userMessageContent,
		didCompleteReadingStream: true,
		didRejectTool: false,
		didAlreadyUseTool: false,
		contentStopReason,
		consecutiveMistakeCount: 0,
		clineMessages: [],
		getTaskMode: vi.fn().mockResolvedValue("code"),
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		providerRef: { deref: () => ({ getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }) }) },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		pushToolResultToUserContent: vi.fn((result: TestToolResult) => {
			userMessageContent.push(result)
			return true
		}),
	}
}

const executeCommandBlock = {
	type: "tool_use",
	id: "tooluse_filtered",
	name: "execute_command",
	params: { command: truncatedCommand },
	nativeArgs: { command: truncatedCommand },
	partial: false,
}

describe("presentAssistantMessage - turns ended by a content stop", () => {
	beforeEach(() => {
		mockExecuteCommandHandle.mockReset()
		mockUseMcpToolHandle.mockReset()
	})

	it("does not run a tool call from a content_filtered turn and tells the model why", async () => {
		const task = makeTask("content_filtered", executeCommandBlock)

		// `as never`: the partial mock only carries the fields presentAssistantMessage reads.
		await presentAssistantMessage(task as never)

		expect(mockExecuteCommandHandle).not.toHaveBeenCalled()
		expect(task.userMessageContent).toHaveLength(1)
		const [result] = task.userMessageContent
		expect(result).toMatchObject({ type: "tool_result", tool_use_id: "tooluse_filtered", is_error: true })
		expect(result.content).toContain("stop reason: content_filtered")
		expect(result.content).toContain("was not run")
		expect(result.content).not.toContain("Malformed command")
	})

	it("does not run a native MCP tool call from a refusal turn", async () => {
		const task = makeTask("refusal (reasoning_extraction)", {
			type: "mcp_tool_use",
			id: "tooluse_mcp",
			name: "mcp_server_tool",
			serverName: "server",
			toolName: "tool",
			arguments: {},
			partial: false,
		})

		await presentAssistantMessage(task as never)

		expect(mockUseMcpToolHandle).not.toHaveBeenCalled()
		expect(task.userMessageContent[0]).toMatchObject({ tool_use_id: "tooluse_mcp", is_error: true })
		expect(task.userMessageContent[0].content).toContain("refusal (reasoning_extraction)")
	})

	it("runs the tool call normally when the turn ended without a content stop", async () => {
		const task = makeTask(undefined, executeCommandBlock)

		await presentAssistantMessage(task as never)

		expect(mockExecuteCommandHandle).toHaveBeenCalledTimes(1)
	})
})
