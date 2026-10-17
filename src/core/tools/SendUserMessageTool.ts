import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface SendUserMessageParams {
	message: string
}

export class SendUserMessageTool extends BaseTool<"send_user_message"> {
	readonly name = "send_user_message" as const

	async execute(params: SendUserMessageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError } = callbacks

		try {
			if (!params.message) {
				task.consecutiveMistakeCount++
				task.recordToolError("send_user_message")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("send_user_message", "message"))
				return
			}

			task.consecutiveMistakeCount = 0
			await task.say("text", params.message, undefined, false)
			pushToolResult("The user has been shown your message verbatim.")
		} catch (error) {
			await handleError("sending a message to the user", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"send_user_message">): Promise<void> {
		const message = block.nativeArgs?.message ?? block.params.message
		await task.say("text", message ?? "", undefined, block.partial)
	}
}

export const sendUserMessageTool = new SendUserMessageTool()
