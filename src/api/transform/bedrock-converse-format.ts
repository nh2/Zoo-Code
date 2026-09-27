import { Anthropic } from "@anthropic-ai/sdk"
import { ConversationRole, Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime"
import { sanitizeOpenAiCallId } from "../../utils/tool-id"

interface BedrockMessageContent {
	type: "text" | "image" | "video" | "tool_use" | "tool_result" | "thinking" | "redacted_thinking"
	text?: string
	// Thinking block fields
	thinking?: string
	signature?: string
	data?: string
	source?: {
		type: "base64"
		data: string | Uint8Array // string for Anthropic, Uint8Array for Bedrock
		media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
	}
	// Video specific fields
	format?: string
	s3Location?: {
		uri: string
		bucketOwner?: string
	}
	// Tool use and result fields
	toolUseId?: string
	name?: string
	input?: any
	output?: any // Used for tool_result type
}

export interface BedrockConverseOptions {
	/**
	 * Send stored thinking blocks back as `reasoningContent`.
	 * Only Claude models understand them; for others they are left out.
	 */
	keepThinking?: boolean
}

/**
 * Converts a stored thinking block back to the Converse shape Bedrock returned it in.
 * A block without a signature can't be verified and fails the request, so it is left out.
 * See https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#append-assistant-turns-exactly-as-returned
 */
function convertThinkingBlock(block: BedrockMessageContent): ContentBlock | undefined {
	if (block.type === "redacted_thinking") {
		return block.data
			? ({
					reasoningContent: { redactedContent: new Uint8Array(Buffer.from(block.data, "base64")) },
				} as ContentBlock)
			: undefined
	}
	return block.signature
		? ({
				reasoningContent: { reasoningText: { text: block.thinking ?? "", signature: block.signature } },
			} as ContentBlock)
		: undefined
}

/**
 * Convert Anthropic messages to Bedrock Converse format
 * @param anthropicMessages Messages in Anthropic format
 */
export function convertToBedrockConverseMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
	options: BedrockConverseOptions = {},
): Message[] {
	return anthropicMessages.map((anthropicMessage) => {
		// Map Anthropic roles to Bedrock roles
		const role: ConversationRole = anthropicMessage.role === "assistant" ? "assistant" : "user"

		if (typeof anthropicMessage.content === "string") {
			return {
				role,
				content: [
					{
						text: anthropicMessage.content,
					},
				] as ContentBlock[],
			}
		}

		// Process complex content types
		const content = anthropicMessage.content.flatMap((block): ContentBlock[] => {
			const messageBlock = block as BedrockMessageContent & {
				id?: string
				tool_use_id?: string
				content?: string | Array<{ type: string; text: string }>
				output?: string | Array<{ type: string; text: string }>
			}

			if (messageBlock.type === "thinking" || messageBlock.type === "redacted_thinking") {
				const converted = options.keepThinking ? convertThinkingBlock(messageBlock) : undefined
				return converted ? [converted] : []
			}

			return [convertBlock(messageBlock)]
		})

		return {
			role,
			content,
		}
	})
}

function convertBlock(
	messageBlock: BedrockMessageContent & {
		id?: string
		tool_use_id?: string
		content?: string | Array<{ type: string; text: string }>
		output?: string | Array<{ type: string; text: string }>
	},
): ContentBlock {
	if (messageBlock.type === "text") {
		return {
			text: messageBlock.text || "",
		} as ContentBlock
	}

	if (messageBlock.type === "image" && messageBlock.source) {
		// Convert base64 string to byte array if needed
		let byteArray: Uint8Array
		if (typeof messageBlock.source.data === "string") {
			const binaryString = atob(messageBlock.source.data)
			byteArray = new Uint8Array(binaryString.length)
			for (let i = 0; i < binaryString.length; i++) {
				byteArray[i] = binaryString.charCodeAt(i)
			}
		} else {
			byteArray = messageBlock.source.data
		}

		// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
		const format = messageBlock.source.media_type.split("/")[1]
		if (!["png", "jpeg", "gif", "webp"].includes(format)) {
			throw new Error(`Unsupported image format: ${format}`)
		}

		return {
			image: {
				format: format as "png" | "jpeg" | "gif" | "webp",
				source: {
					bytes: byteArray,
				},
			},
		} as ContentBlock
	}

	if (messageBlock.type === "tool_use") {
		// Native-only: keep input as JSON object for Bedrock's toolUse format
		return {
			toolUse: {
				toolUseId: sanitizeOpenAiCallId(messageBlock.id || ""),
				name: messageBlock.name || "",
				input: messageBlock.input || {},
			},
		} as ContentBlock
	}

	if (messageBlock.type === "tool_result") {
		// Handle content field - can be string or array (native tool format)
		if (messageBlock.content) {
			// Content is a string
			if (typeof messageBlock.content === "string") {
				return {
					toolResult: {
						toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
						content: [
							{
								text: messageBlock.content,
							},
						],
						status: "success",
					},
				} as ContentBlock
			}
			// Content is an array of content blocks
			if (Array.isArray(messageBlock.content)) {
				return {
					toolResult: {
						toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
						content: messageBlock.content.map((item) => ({
							text: typeof item === "string" ? item : item.text || String(item),
						})),
						status: "success",
					},
				} as ContentBlock
			}
		}

		// Fall back to output handling if content is not available
		if (messageBlock.output && typeof messageBlock.output === "string") {
			return {
				toolResult: {
					toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
					content: [
						{
							text: messageBlock.output,
						},
					],
					status: "success",
				},
			} as ContentBlock
		}
		// Handle array of content blocks if output is an array
		if (Array.isArray(messageBlock.output)) {
			return {
				toolResult: {
					toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
					content: messageBlock.output.map((part) => {
						if (typeof part === "object" && "text" in part) {
							return { text: part.text }
						}
						// Skip images in tool results as they're handled separately
						if (typeof part === "object" && "type" in part && part.type === "image") {
							return { text: "(see following message for image)" }
						}
						return { text: String(part) }
					}),
					status: "success",
				},
			} as ContentBlock
		}

		// Default case
		return {
			toolResult: {
				toolUseId: sanitizeOpenAiCallId(messageBlock.tool_use_id || ""),
				content: [
					{
						text: String(messageBlock.output || ""),
					},
				],
				status: "success",
			},
		} as ContentBlock
	}

	if (messageBlock.type === "video") {
		const videoContent = messageBlock.s3Location
			? {
					s3Location: {
						uri: messageBlock.s3Location.uri,
						bucketOwner: messageBlock.s3Location.bucketOwner,
					},
				}
			: messageBlock.source

		return {
			video: {
				format: "mp4", // Default to mp4, adjust based on actual format if needed
				source: videoContent,
			},
		} as ContentBlock
	}

	// Default case for unknown block types
	return {
		text: "[Unknown Block Type]",
	} as ContentBlock
}
