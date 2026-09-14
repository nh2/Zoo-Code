import { MAX_LINE_BYTES } from "../../../core/prompts/tools/native-tools/read_file"
import { formatWithLineNumbers, parseLines, readWithIndentation, readWithSlice } from "../indentation-reader"

// Ported from upstream #1960, which guarded the old character-based cut against
// splitting a UTF-16 surrogate pair. The per-line cap is now measured in UTF-8
// bytes, so each case is re-derived for byte boundaries; the property under test
// is unchanged: a clipped line never decodes to a broken character.

// Spelled out rather than built with formatTruncationMarker, so the format is
// pinned here independently of the implementation.
function marker(omittedBytes: number, startOffset: number, endOffset: number): string {
	const unit = omittedBytes === 1 ? "byte" : "bytes"
	return `[+${omittedBytes} ${unit} omitted, starting at byte offset ${startOffset} up to and including byte offset ${endOffset}]`
}

function expectLosslessUtf8(text: string): void {
	expect(Buffer.from(text, "utf8").toString("utf8")).toBe(text)
	expect(text).not.toContain("\uFFFD")
}

describe("line formatting Unicode boundaries", () => {
	it("does not leave a broken character when the cap falls between sequences", () => {
		// 2000 four-byte emoji: the 2000-byte cap lands exactly after the 500th.
		const { content, truncatedLines } = formatWithLineNumbers(parseLines("🔥".repeat(2000)))
		expect(content).toBe(`1 | ${"🔥".repeat(500)}${marker(6000, 2000, 7999)}`)
		expectLosslessUtf8(content)
		expect(truncatedLines).toHaveLength(1)
	})

	it("backs off a sequence the cap would split", () => {
		// One ASCII byte shifts every emoji, so the cap lands 3 bytes into the 500th:
		// 1 + 499 * 4 = 1997 bytes are kept, never more than the cap.
		const { content, truncatedLines } = formatWithLineNumbers(parseLines("a" + "🔥".repeat(2000)))
		expect(content).toBe(`1 | a${"🔥".repeat(499)}${marker(6004, 1997, 8000)}`)
		expectLosslessUtf8(content)
		expect(8001 - truncatedLines[0].omittedBytes).toBeLessThanOrEqual(MAX_LINE_BYTES)
	})

	it.each([
		// [name, line, kept, omittedBytes, startOffset, endOffset], all with an 8-byte cap
		["4-byte sequence crossing the cap", "abcdef🔥tail", "abcdef", 8, 6, 13],
		["4-byte sequence ending at the cap", "abcd🔥tail", "abcd🔥", 4, 8, 11],
		["4-byte sequence after the cap", "abcdefgh🔥tail", "abcdefgh", 8, 8, 15],
		["lowest supplementary code point", `abcdef${String.fromCodePoint(0x10000)}tail`, "abcdef", 8, 6, 13],
		["highest code point", `abcdef${String.fromCodePoint(0x10ffff)}tail`, "abcdef", 8, 6, 13],
		// U+D7FF and U+E000 encode as ED 9F BF and EE 80 80, right next to the
		// surrogate range, which UTF-8 never encodes: they must be kept whole.
		["BMP below the surrogate range", "abcde\ud7fftail", "abcde\ud7ff", 4, 8, 11],
		["BMP above the surrogate range", "abcde\ue000tail", "abcde\ue000", 4, 8, 11],
		["3-byte sequence crossing the cap", "abcdef\ud7fftail", "abcdef", 7, 6, 12],
		// Ж é Ω ß are 2 bytes and 文 is 3, so the cap lands 1 byte into Ω.
		["mixed-width non-ASCII text", "Жé文Ωßtail", "Жé文", 8, 7, 14],
		// Code point boundaries are respected, grapheme clusters are not:
		["combining mark separated from its base", "abcdefgh\u0301tail", "abcdefgh", 6, 8, 13],
		["ZWJ sequence without grapheme segmentation", "a👩\u200d💻tail", "a👩\u200d", 8, 8, 15],
	])("clips a %s without breaking a character", (_name, line, kept, omittedBytes, startOffset, endOffset) => {
		const { content, truncatedLines } = formatWithLineNumbers(parseLines(line), 8)
		expect(content).toBe(`1 | ${kept}${marker(omittedBytes, startOffset, endOffset)}`)
		expectLosslessUtf8(content)
		expect(Buffer.byteLength(kept, "utf8")).toBeLessThanOrEqual(8)
		expect(truncatedLines).toEqual([
			{
				lineNumber: 1,
				lineByteLength: Buffer.byteLength(line, "utf8"),
				omittedBytes,
				omittedStartOffset: startOffset,
				omittedEndOffset: endOffset,
			},
		])
	})

	it.each(["abc", "abcdefgh", "🔥🔥", "e\u0301👩"])("preserves text at or below the cap: %s", (line) => {
		const { content, truncatedLines } = formatWithLineNumbers(parseLines(line), 8)
		expect(content).toBe(`1 | ${line}`)
		expectLosslessUtf8(content)
		expect(truncatedLines).toEqual([])
	})

	it.each([0, 1, 2, 3])("gives the whole budget of a tiny cap of %i to content", (cap) => {
		// The old character cut reserved 3 characters for "..."; the marker now sits outside the budget.
		const { content } = formatWithLineNumbers(parseLines("abcdef"), cap)
		expect(content).toBe(`1 | ${"abcdef".slice(0, cap)}${marker(6 - cap, cap, 5)}`)
	})

	it.each([
		[3, "", 8, 0],
		[4, "🔥", 4, 4],
	])("clips a leading emoji with a cap of %i", (cap, kept, omittedBytes, startOffset) => {
		const { content } = formatWithLineNumbers(parseLines("🔥tail"), cap)
		expect(content).toBe(`1 | ${kept}${marker(omittedBytes, startOffset, 7)}`)
		expectLosslessUtf8(content)
	})

	it("aligns line numbers and reports file-absolute offsets alongside Unicode", () => {
		// Line 10 starts at byte 11 + 8 * 7 = 67.
		const lines = parseLines(`abcdefghij\n${"middle\n".repeat(8)}abcdef🔥tail`)
		const { content } = formatWithLineNumbers([lines[0], lines[9]], 8)
		expect(content).toBe(` 1 | abcdefgh${marker(2, 8, 9)}\n10 | abcdef${marker(8, 73, 80)}`)
	})

	it("preserves empty formatting and the existing zero line-number fallback", () => {
		expect(formatWithLineNumbers([])).toEqual({ content: "", truncatedLines: [] })
		expect(formatWithLineNumbers([{ ...parseLines("🔥")[0], lineNumber: 0 }]).content).toBe("0 | 🔥")
	})
})

describe("Unicode clipping through the existing readers", () => {
	// 8000 bytes. With 4 leading spaces of indentation, the cap keeps 4 + 499 * 4 = 2000 bytes.
	const longLine = "🔥".repeat(2000)

	it("preserves slice selection, ranges and truncation metadata", () => {
		// Line 2 starts at byte 7, after "before\n".
		const result = readWithSlice(`before\n${longLine}\nafter`, 1, 1)
		expect(result).toEqual({
			content: `2 | ${"🔥".repeat(500)}${marker(6000, 2007, 8006)}`,
			includedRanges: [[2, 2]],
			totalLines: 3,
			returnedLines: 1,
			wasTruncated: true,
			truncatedLines: [
				{
					lineNumber: 2,
					lineByteLength: 8000,
					omittedBytes: 6000,
					omittedStartOffset: 2007,
					omittedEndOffset: 8006,
				},
			],
		})
		expectLosslessUtf8(result.content)
	})

	it("preserves indentation selection and metadata with a single-line limit", () => {
		// Line 2 starts at byte 21, after "function example() {\n".
		const result = readWithIndentation(`function example() {\n    ${longLine}\n}`, {
			anchorLine: 2,
			limit: 1,
		})
		expect(result).toEqual({
			content: `2 |     ${"🔥".repeat(499)}${marker(6004, 2021, 8024)}`,
			includedRanges: [[2, 2]],
			totalLines: 3,
			returnedLines: 1,
			wasTruncated: true,
			truncatedLines: [
				{
					lineNumber: 2,
					lineByteLength: 8004,
					omittedBytes: 6004,
					omittedStartOffset: 2021,
					omittedEndOffset: 8024,
				},
			],
		})
		expectLosslessUtf8(result.content)
	})

	it("preserves indentation expansion, blank trimming and complete-file metadata", () => {
		// The leading blank line shifts line 3 to start at byte 22.
		const result = readWithIndentation(`\nfunction example() {\n    ${longLine}\n}\n`, {
			anchorLine: 3,
			includeSiblings: true,
		})
		expect(result).toEqual({
			content: `2 | function example() {\n3 |     ${"🔥".repeat(499)}${marker(6004, 2022, 8025)}\n4 | }`,
			includedRanges: [[2, 4]],
			totalLines: 5,
			returnedLines: 3,
			wasTruncated: false,
			truncatedLines: [
				{
					lineNumber: 3,
					lineByteLength: 8004,
					omittedBytes: 6004,
					omittedStartOffset: 2022,
					omittedEndOffset: 8025,
				},
			],
		})
		expectLosslessUtf8(result.content)
	})

	it("preserves default slice limits and empty input", () => {
		expect(readWithSlice(longLine)).toEqual({
			content: `1 | ${"🔥".repeat(500)}${marker(6000, 2000, 7999)}`,
			includedRanges: [[1, 1]],
			totalLines: 1,
			returnedLines: 1,
			wasTruncated: false,
			truncatedLines: [
				{
					lineNumber: 1,
					lineByteLength: 8000,
					omittedBytes: 6000,
					omittedStartOffset: 2000,
					omittedEndOffset: 7999,
				},
			],
		})
		expect(readWithSlice("")).toEqual({
			content: "1 | ",
			includedRanges: [[1, 1]],
			totalLines: 1,
			returnedLines: 1,
			wasTruncated: false,
			truncatedLines: [],
		})
	})

	it("preserves reader errors without formatting or leaking the long line", () => {
		expect(readWithSlice(longLine, 1)).toEqual({
			content: "Error: offset 1 is beyond file end (1 lines)",
			includedRanges: [],
			totalLines: 1,
			returnedLines: 0,
			wasTruncated: false,
			truncatedLines: [],
		})
		expect(readWithIndentation(longLine, { anchorLine: 0 })).toEqual({
			content: "Error: anchor_line 0 is out of range (1-1)",
			includedRanges: [],
			totalLines: 1,
			returnedLines: 0,
			wasTruncated: false,
			truncatedLines: [],
		})
	})
})
