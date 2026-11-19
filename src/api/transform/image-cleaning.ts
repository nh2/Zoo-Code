import type { Anthropic } from "@anthropic-ai/sdk"

import { MAX_IMAGE_BASE64_LENGTH } from "@roo-code/types"

import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

export const UNSUPPORTED_IMAGE_PLACEHOLDER = "[Referenced image in conversation]"

export function oversizedImagePlaceholder(base64Length: number): string {
	const sizeMB = (base64Length / (1024 * 1024)).toFixed(1)
	const maxMB = MAX_IMAGE_BASE64_LENGTH / (1024 * 1024)
	return `[Image omitted: its encoded size of ${sizeMB} MB exceeds the ${maxMB} MB limit per image]`
}

type ContentBlock = Exclude<ApiMessage["content"], string>[number]

function replaceImage(block: Anthropic.ImageBlockParam, supportsImages: boolean): Anthropic.TextBlockParam | null {
	if (!supportsImages) {
		return { type: "text", text: UNSUPPORTED_IMAGE_PLACEHOLDER }
	}
	if (block.source.type === "base64" && block.source.data.length > MAX_IMAGE_BASE64_LENGTH) {
		return { type: "text", text: oversizedImagePlaceholder(block.source.data.length) }
	}
	return null
}

function cleanBlock(block: ContentBlock, supportsImages: boolean): ContentBlock {
	if (block.type === "image") {
		return replaceImage(block, supportsImages) ?? block
	}
	if (block.type === "tool_result" && Array.isArray(block.content)) {
		let changed = false
		const content = block.content.map((inner) => {
			if (inner.type !== "image") {
				return inner
			}
			const replacement = replaceImage(inner, supportsImages)
			if (!replacement) {
				return inner
			}
			changed = true
			return replacement
		})
		return changed ? { ...block, content } : block
	}
	return block
}

/**
 * Replaces image blocks the provider would reject with text placeholders:
 * all images if the model doesn't support them, otherwise only images over `MAX_IMAGE_BASE64_LENGTH`.
 * The stored history keeps the original, so a task with an oversized image isn't stuck on retries.
 */
export function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	const supportsImages = apiHandler.getModel().info.supportsImages ?? false

	return messages.map((message) => {
		const { content } = message
		if (!Array.isArray(content)) {
			return { ...message }
		}
		return { ...message, content: content.map((block) => cleanBlock(block, supportsImages)) }
	})
}
