import type { ModelInfo } from "@roo-code/types"

export type BedrockCacheTtl = "5m" | "1h"

/** Bedrock's per-TTL breakdown of cache write tokens (`usage.cacheDetails`). */
export interface BedrockCacheDetail {
	ttl: BedrockCacheTtl
	inputTokens: number
}

export interface BedrockCacheState {
	/** Tokens cached (written or read) by the previous request. */
	cachedTokens: number
	/** Epoch ms at which the cache last written/refreshed expires. */
	expiresAt: number
}

export interface BedrockCacheCostInput {
	modelInfo: ModelInfo
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	cacheDetails?: BedrockCacheDetail[]
	/** TTL configured for the request, used when Bedrock reports no breakdown. */
	configuredTtl: BedrockCacheTtl
	previous?: BedrockCacheState
	now: number
}

export interface BedrockCacheCostResult {
	totalCost: number
	/** Extra cost paid because an already-cached prefix had to be written again. */
	cacheInvalidationCost: number
	/** Epoch ms when the cache refreshed by this request expires (undefined if nothing is cached). */
	cacheExpiresAt?: number
	state?: BedrockCacheState
}

const TTL_MS: Record<BedrockCacheTtl, number> = { "5m": 5 * 60_000, "1h": 60 * 60_000 }
const WRITE_MULTIPLIER: Record<BedrockCacheTtl, number> = { "5m": 1.25, "1h": 2 }

/** Price per million tokens for writing to the cache with the given TTL. */
export function cacheWritePrice(modelInfo: ModelInfo, ttl: BedrockCacheTtl): number {
	const input = modelInfo.inputPrice ?? 0
	if (ttl === "5m") {
		return modelInfo.cacheWritesPrice ?? input * WRITE_MULTIPLIER["5m"]
	}
	return input * WRITE_MULTIPLIER["1h"]
}

export function calculateBedrockCacheCost(args: BedrockCacheCostInput): BedrockCacheCostResult {
	const { modelInfo, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, previous, now } = args
	const perToken = (price: number) => price / 1_000_000

	// Fall back to the configured TTL when Bedrock reports no per-TTL breakdown.
	const details: BedrockCacheDetail[] = args.cacheDetails?.length
		? args.cacheDetails
		: cacheWriteTokens > 0
			? [{ ttl: args.configuredTtl, inputTokens: cacheWriteTokens }]
			: []

	const cacheWriteCost = details.reduce(
		(sum, d) => sum + perToken(cacheWritePrice(modelInfo, d.ttl)) * d.inputTokens,
		0,
	)
	const totalCost =
		perToken(modelInfo.inputPrice ?? 0) * inputTokens +
		perToken(modelInfo.outputPrice ?? 0) * outputTokens +
		perToken(modelInfo.cacheReadsPrice ?? 0) * cacheReadTokens +
		cacheWriteCost

	// A prefix that was cached by the previous request but not read now was re-written
	// (the cache expired or the prefix changed). Charge the write/read price difference.
	let cacheInvalidationCost = 0
	if (previous && cacheWriteTokens > 0) {
		const rewrittenTokens = Math.min(cacheWriteTokens, Math.max(0, previous.cachedTokens - cacheReadTokens))
		if (rewrittenTokens > 0) {
			const avgWritePrice = cacheWriteCost / perToken(1) / cacheWriteTokens
			cacheInvalidationCost = perToken(avgWritePrice - (modelInfo.cacheReadsPrice ?? 0)) * rewrittenTokens
		}
	}

	// Reads refresh the TTL as well as writes.
	const refreshed = cacheWriteTokens > 0 || cacheReadTokens > 0
	if (!refreshed) {
		return { totalCost, cacheInvalidationCost }
	}
	const longest = details.some((d) => d.ttl === "1h") ? "1h" : details.length ? "5m" : args.configuredTtl
	const expiresAt = now + TTL_MS[longest]
	return {
		totalCost,
		cacheInvalidationCost,
		cacheExpiresAt: expiresAt,
		state: { cachedTokens: cacheReadTokens + cacheWriteTokens, expiresAt },
	}
}
