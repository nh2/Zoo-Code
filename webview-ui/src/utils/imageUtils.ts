import { MAX_IMAGE_BASE64_LENGTH } from "@roo-code/types"

/**
 * Utility function to append new images to existing images array
 * while respecting the maximum image limit
 *
 * @param currentImages - The current array of images
 * @param newImages - The new images to append
 * @param maxImages - The maximum number of images allowed
 * @returns The updated images array
 */
export function appendImages(currentImages: string[], newImages: string[] | undefined, maxImages: number): string[] {
	const imagesToAdd = newImages ?? []
	if (imagesToAdd.length === 0) {
		return currentImages
	}

	return [...currentImages, ...imagesToAdd].slice(0, maxImages)
}

export function base64PayloadLength(dataUrl: string): number {
	return dataUrl.length - (dataUrl.indexOf(",") + 1)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error("Failed to decode image"))
		image.src = dataUrl
	})
}

const MAX_SHRINK_ATTEMPTS = 8

export interface ShrunkImage {
	dataUrl: string
	resized: boolean
}

/**
 * Downscales an image data URL until its base64 payload fits `maxBase64Length`, keeping its MIME type.
 * Returns the input unchanged if it already fits, or `null` if it can't be decoded or shrunk enough.
 */
export async function shrinkImageDataUrl(
	dataUrl: string,
	maxBase64Length: number = MAX_IMAGE_BASE64_LENGTH,
): Promise<ShrunkImage | null> {
	const originalLength = base64PayloadLength(dataUrl)
	if (originalLength <= maxBase64Length) {
		return { dataUrl, resized: false }
	}

	let image: HTMLImageElement
	try {
		image = await loadImage(dataUrl)
	} catch {
		return null
	}

	const canvas = document.createElement("canvas")
	const context = canvas.getContext("2d")
	if (!context || image.naturalWidth === 0 || image.naturalHeight === 0) {
		return null
	}

	const mimeType = dataUrl.slice("data:".length, dataUrl.indexOf(";"))
	// Encoded size scales roughly with pixel count, so scale each side by the square root of the ratio.
	let scale = Math.sqrt(maxBase64Length / originalLength)
	for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt++) {
		canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale))
		canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale))
		context.drawImage(image, 0, 0, canvas.width, canvas.height)
		const resized = canvas.toDataURL(mimeType, 0.9)
		if (base64PayloadLength(resized) <= maxBase64Length) {
			return { dataUrl: resized, resized: true }
		}
		scale *= 0.8
	}
	return null
}
