import type OpenAI from "openai"

const SEND_USER_MESSAGE_DESCRIPTION = `Show the user a message in the chat exactly as written, then continue working. Unlike attempt_completion and ask_followup_question, this does not end or pause your turn.

Text you write outside tool calls reaches the user only as a short summary, so use this tool for anything the user must see verbatim: links, file paths, exact numbers, code, commands, tables, or lists of results. Don't use it for routine progress notes; plain text is fine for those.

The message is rendered as Markdown.`

const MESSAGE_PARAMETER_DESCRIPTION = `The message to show the user, in Markdown`

export default {
	type: "function",
	function: {
		name: "send_user_message",
		description: SEND_USER_MESSAGE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				message: {
					type: "string",
					description: MESSAGE_PARAMETER_DESCRIPTION,
				},
			},
			required: ["message"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
