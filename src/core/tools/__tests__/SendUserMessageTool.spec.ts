import type { Mock } from "vitest"

import type { Task } from "../../task/Task"
import type { AskApproval, HandleError, PushToolResult, ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { SendUserMessageTool } from "../SendUserMessageTool"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"

describe("SendUserMessageTool", () => {
	let tool: SendUserMessageTool
	let mockTask: Task
	let say: Mock
	let pushToolResult: Mock<PushToolResult>
	let askApproval: Mock<AskApproval>
	let callbacks: ToolCallbacks

	beforeEach(() => {
		tool = new SendUserMessageTool()
		say = vi.fn().mockResolvedValue(undefined)
		mockTask = {
			consecutiveMistakeCount: 2,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn(),
			say,
		} as unknown as Task
		pushToolResult = vi.fn<PushToolResult>()
		askApproval = vi.fn<AskApproval>()
		callbacks = { askApproval, handleError: vi.fn<HandleError>(), pushToolResult }
	})

	function block(message: string | undefined, partial = false): ToolUse<"send_user_message"> {
		return {
			type: "tool_use",
			name: "send_user_message",
			params: message === undefined ? {} : { message },
			partial,
			nativeArgs: message === undefined ? undefined : { message },
		} as ToolUse<"send_user_message">
	}

	it("shows the message verbatim as assistant text without asking or ending the turn", async () => {
		const message = "- [`probe-A1-kestrel.txt`](files-A/probe-A1-kestrel.txt): 203 bytes"

		await tool.handle(mockTask, block(message), callbacks)

		expect(say).toHaveBeenCalledWith("text", message, undefined, false)
		expect(mockTask.ask).not.toHaveBeenCalled()
		expect(askApproval).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith("The user has been shown your message verbatim.")
		expect(mockTask.consecutiveMistakeCount).toBe(0)
	})

	it("reports a missing message as a tool error and shows nothing", async () => {
		await tool.execute({ message: "" }, mockTask, callbacks)

		expect(say).not.toHaveBeenCalled()
		expect(mockTask.recordToolError).toHaveBeenCalledWith("send_user_message")
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("send_user_message", "message")
		expect(pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("streams a partial message as partial assistant text", async () => {
		await tool.handle(mockTask, block("Links so f", true), callbacks)

		expect(say).toHaveBeenCalledWith("text", "Links so f", undefined, true)
		expect(pushToolResult).not.toHaveBeenCalled()
	})

	it("gets its message from the native tool-call parser", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_1",
			name: "send_user_message",
			arguments: JSON.stringify({ message: "exact text" }),
		})

		expect(result?.type).toBe("tool_use")
		if (result?.type === "tool_use") {
			expect(result.nativeArgs).toEqual({ message: "exact text" })
		}
	})
})
