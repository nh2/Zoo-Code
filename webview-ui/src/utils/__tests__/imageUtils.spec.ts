import type { MockInstance } from "vitest"

import { base64PayloadLength, shrinkImageDataUrl } from "../imageUtils"

const dataUrl = (length: number, mimeType = "image/png") => `data:${mimeType};base64,${"A".repeat(length)}`

class LoadedImage {
	naturalWidth = 1000
	naturalHeight = 800
	onload: (() => void) | null = null
	onerror: (() => void) | null = null
	set src(_value: string) {
		queueMicrotask(() => this.onload?.())
	}
}

class BrokenImage extends LoadedImage {
	override set src(_value: string) {
		queueMicrotask(() => this.onerror?.())
	}
}

describe("shrinkImageDataUrl", () => {
	// Encoded size proportional to the pixel count, like a real encoder would roughly produce.
	const encodedLengthPerPixel = 0.01
	let toDataURL: MockInstance<HTMLCanvasElement["toDataURL"]>

	beforeEach(() => {
		vi.stubGlobal("Image", LoadedImage)
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D) // Only `drawImage` is used.
		toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
			this: HTMLCanvasElement,
			mimeType?: string,
		) {
			return dataUrl(Math.ceil(this.width * this.height * encodedLengthPerPixel), mimeType)
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("returns an image within the limit unchanged", async () => {
		const original = dataUrl(100)

		await expect(shrinkImageDataUrl(original, 100)).resolves.toEqual({ dataUrl: original, resized: false })
		expect(toDataURL).not.toHaveBeenCalled()
	})

	it.each(["image/png", "image/jpeg", "image/webp"])(
		"downscales an oversized %s image below the limit, keeping its type",
		async (mimeType) => {
			const result = await shrinkImageDataUrl(dataUrl(20_000, mimeType), 5_000)

			expect(result?.resized).toBe(true)
			expect(result?.dataUrl.startsWith(`data:${mimeType};base64,`)).toBe(true)
			expect(base64PayloadLength(result!.dataUrl)).toBeLessThanOrEqual(5_000)
			expect(toDataURL).toHaveBeenCalledWith(mimeType, 0.9)
		},
	)

	it("returns null when the image cannot be shrunk enough", async () => {
		toDataURL.mockImplementation(() => dataUrl(10_000))

		await expect(shrinkImageDataUrl(dataUrl(20_000), 5_000)).resolves.toBeNull()
	})

	it("returns null when the image cannot be decoded", async () => {
		vi.stubGlobal("Image", BrokenImage)

		await expect(shrinkImageDataUrl(dataUrl(20_000), 5_000)).resolves.toBeNull()
	})
})
