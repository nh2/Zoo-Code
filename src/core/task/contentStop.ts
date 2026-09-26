/**
 * The stop reason when a safety classifier or guardrail ended the turn, otherwise undefined.
 *
 * Such a stop cuts generation off mid-output:
 * Bedrock then closes the open JSON of a streaming tool call (e.g. `…"intel-nvid"}`),
 * so a truncated call still parses and would run.
 * Anthropic's guidance is to treat partial output of a refused turn as incomplete and discard it.
 * See #1820.
 *
 * - https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#what-a-refusal-looks-like
 * - https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStreamMetadataEvent.html
 */
export function findContentStopReason(stopReasons: readonly string[]): string | undefined {
	// Matches the bare reason and the "reason (details)" form Bedrock builds from stop_details.
	return stopReasons.find((reason) => /^(content_filtered|refusal|guardrail_intervened)\b/.test(reason))
}
