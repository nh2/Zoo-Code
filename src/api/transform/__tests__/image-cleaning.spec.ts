// npx vitest run api/transform/__tests__/image-cleaning.spec.ts

import { MAX_IMAGE_BASE64_LENGTH, type ModelInfo } from "@roo-code/types"

import { ApiHandler } from "../../index"
import { ApiMessage } from "../../../core/task-persistence/apiMessages"
import { maybeRemoveImageBlocks, oversizedImagePlaceholder } from "../image-cleaning"

describe("maybeRemoveImageBlocks", () => {
	// Mock ApiHandler factory function
	const createMockApiHandler = (supportsImages: boolean): ApiHandler => {
		return {
			getModel: vitest.fn().mockReturnValue({
				id: "test-model",
				info: {
					supportsImages,
				} as ModelInfo,
			}),
			createMessage: vitest.fn(),
			countTokens: vitest.fn(),
			getModelCacheScope: vitest.fn().mockReturnValue({
				urlScoped: false,
				keyScoped: false,
				authScoped: false,
			}),
		}
	}

	it("should handle empty messages array", () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = []

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual([])
		// No need to check if getModel was called since there are no messages to process
	})

	it("should not modify messages with no image blocks", () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: "Hello, world!",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual(messages)
		// getModel is only called when content is an array, which is not the case here
	})

	it("should not modify messages with array content but no image blocks", () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Hello, world!",
					},
					{
						type: "text",
						text: "How are you?",
					},
				],
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		expect(result).toEqual(messages)
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	it("should not modify image blocks when API handler supports images", () => {
		const apiHandler = createMockApiHandler(true)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64-encoded-image-data",
						},
					},
				],
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		// Should not modify the messages since the API handler supports images
		expect(result).toEqual(messages)
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	it("should convert image blocks to text descriptions when API handler doesn't support images", () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64-encoded-image-data",
						},
					},
				],
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Check out this image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	it("should handle mixed content messages with multiple text and image blocks", () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here are some images:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data-1",
						},
					},
					{
						type: "text",
						text: "And another one:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "image-data-2",
						},
					},
				],
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert all image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here are some images:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
					{
						type: "text",
						text: "And another one:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	it("should handle multiple messages with image blocks", () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data-1",
						},
					},
				],
			},
			{
				role: "assistant",
				content: "I see the image!",
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's another image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: "image-data-2",
						},
					},
				],
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert all image blocks to text descriptions
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
			{
				role: "assistant",
				content: "I see the image!",
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's another image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
			},
		])
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	it("should preserve additional message properties", () => {
		const apiHandler = createMockApiHandler(false)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "image-data",
						},
					},
				],
				ts: 1620000000000,
				isSummary: true,
			},
		]

		const result = maybeRemoveImageBlocks(messages, apiHandler)

		// Should convert image blocks to text descriptions while preserving additional properties
		expect(result).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Here's an image:",
					},
					{
						type: "text",
						text: "[Referenced image in conversation]",
					},
				],
				ts: 1620000000000,
				isSummary: true,
			},
		])
		expect(apiHandler.getModel).toHaveBeenCalled()
	})

	describe("oversized images", () => {
		const imageBlock = (length: number) => ({
			type: "image" as const,
			source: { type: "base64" as const, media_type: "image/png" as const, data: "A".repeat(length) },
		})

		it.each([
			{ length: MAX_IMAGE_BASE64_LENGTH, kept: true },
			{ length: MAX_IMAGE_BASE64_LENGTH + 4, kept: false },
		])("keeps=$kept for a base64 payload of $length characters", ({ length, kept }) => {
			const image = imageBlock(length)
			const messages: ApiMessage[] = [{ role: "user", content: [{ type: "text", text: "Look:" }, image] }]

			const result = maybeRemoveImageBlocks(messages, createMockApiHandler(true))

			expect(result[0].content).toEqual([
				{ type: "text", text: "Look:" },
				kept ? image : { type: "text", text: oversizedImagePlaceholder(length) },
			])
		})

		it("replaces oversized images inside tool results and keeps the others", () => {
			const small = imageBlock(16)
			const large = imageBlock(5_280_844)
			const messages: ApiMessage[] = [
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "t1", content: [small, large] }],
				},
			]

			const result = maybeRemoveImageBlocks(messages, createMockApiHandler(true))

			expect(result[0].content).toEqual([
				{
					type: "tool_result",
					tool_use_id: "t1",
					content: [small, { type: "text", text: oversizedImagePlaceholder(5_280_844) }],
				},
			])
			expect(oversizedImagePlaceholder(5_280_844)).toBe(
				"[Image omitted: its encoded size of 5.0 MB exceeds the 5 MB limit per image]",
			)
		})

		it("does not mutate the stored history", () => {
			const large = imageBlock(MAX_IMAGE_BASE64_LENGTH + 4)
			const messages: ApiMessage[] = [{ role: "user", content: [large] }]

			maybeRemoveImageBlocks(messages, createMockApiHandler(true))

			expect(messages[0].content).toEqual([large])
		})
	})
})
