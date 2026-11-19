/**
 * Largest base64 payload accepted for a single image.
 *
 * Anthropic (also via Bedrock and Vertex) rejects larger images with "image exceeds 5 MB maximum".
 * It measures the base64 string, not the decoded bytes.
 * Base64 encodes every 3 bytes as 4 characters, so the raw image may be at most 5 MiB * 3/4 = 3.75 MiB.
 *
 */
export const MAX_IMAGE_BASE64_LENGTH = 5 * 1024 * 1024
