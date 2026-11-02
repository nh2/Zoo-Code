import type { ModelInfo } from "@roo-code/types"

import { calculateBedrockCacheCost } from "../bedrock-cache-cost"

const modelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsPromptCache: true,
	inputPrice: 3,
	outputPrice: 15,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

const base = { modelInfo, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, configuredTtl: "5m" as const, now: 0 }

describe("calculateBedrockCacheCost", () => {
	it("prices 5m and 1h writes separately within one request", () => {
		const result = calculateBedrockCacheCost({
			...base,
			cacheWriteTokens: 2_000_000,
			cacheDetails: [
				{ ttl: "5m", inputTokens: 1_000_000 },
				{ ttl: "1h", inputTokens: 1_000_000 },
			],
		})
		expect(result.totalCost).toBeCloseTo(3.75 + 6)
	})

	it.each([
		["5m", 3.75, 5 * 60_000],
		["1h", 6, 60 * 60_000],
	] as const)("uses the configured %s TTL without a breakdown", (ttl, cost, expiry) => {
		const result = calculateBedrockCacheCost({ ...base, cacheWriteTokens: 1_000_000, configuredTtl: ttl })
		expect(result.totalCost).toBeCloseTo(cost)
		expect(result.cacheExpiresAt).toBe(expiry)
	})

	it("reports no invalidation cost when the prefix is read from cache", () => {
		const result = calculateBedrockCacheCost({
			...base,
			cacheReadTokens: 100_000,
			cacheWriteTokens: 5_000,
			previous: { cachedTokens: 100_000, expiresAt: 1 },
		})
		expect(result.cacheInvalidationCost).toBe(0)
	})

	it("charges the write/read difference for a re-written prefix", () => {
		const result = calculateBedrockCacheCost({
			...base,
			cacheReadTokens: 0,
			cacheWriteTokens: 1_000_000,
			previous: { cachedTokens: 1_000_000, expiresAt: 1 },
		})
		expect(result.cacheInvalidationCost).toBeCloseTo(3.75 - 0.3)
	})

	it("returns no expiry when nothing was cached", () => {
		const result = calculateBedrockCacheCost({ ...base, inputTokens: 10, cacheWriteTokens: 0 })
		expect(result.cacheExpiresAt).toBeUndefined()
		expect(result.state).toBeUndefined()
	})
})
