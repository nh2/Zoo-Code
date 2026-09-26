import { findContentStopReason } from "../contentStop"

describe("findContentStopReason", () => {
	it.each([
		[["content_filtered"], "content_filtered"],
		[["refusal"], "refusal"],
		[["guardrail_intervened"], "guardrail_intervened"],
		[["content_filtered (reasoning_extraction: Declined.)"], "content_filtered (reasoning_extraction: Declined.)"],
		[["tool_use", "refusal (cyber)"], "refusal (cyber)"],
	])("reports %j as a content stop", (stopReasons, expected) => {
		expect(findContentStopReason(stopReasons)).toBe(expected)
	})

	it.each([[[]], [["tool_use"]], [["end_turn"]], [["max_tokens"]], [["stop_sequence"]], [["not_content_filtered"]]])(
		"does not treat %j as a content stop",
		(stopReasons) => {
			expect(findContentStopReason(stopReasons)).toBeUndefined()
		},
	)
})
