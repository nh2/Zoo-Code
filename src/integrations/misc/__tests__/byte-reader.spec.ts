import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import {
	readByteWindow,
	formatByteReadResult,
	countPartialSequenceAtStart,
	countPartialSequenceAtEnd,
	DEFAULT_BYTE_LIMIT,
	MAX_BYTE_LIMIT,
} from "../byte-reader"
import { readWithSlice } from "../indentation-reader"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "byte-reader-"))
})

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true })
})

/** Write a fixture file and return its absolute path. */
async function writeFixture(name: string, content: string | Buffer): Promise<string> {
	const filePath = path.join(tmpDir, name)
	await fs.writeFile(filePath, content)
	return filePath
}

// ─── UTF-8 Boundary Helpers ───────────────────────────────────────────────────

describe("countPartialSequenceAtStart", () => {
	it("should report no partial sequence when starting on a lead byte", () => {
		expect(countPartialSequenceAtStart(Buffer.from("héllo", "utf8"))).toBe(0)
	})

	it("should count continuation bytes orphaned by the window start", () => {
		// "é" is 0xC3 0xA9; a window starting mid-character sees only 0xA9.
		const full = Buffer.from("é", "utf8")
		expect(countPartialSequenceAtStart(full.subarray(1))).toBe(1)
	})

	it("should count up to three continuation bytes for a 4-byte sequence", () => {
		// "𝄞" is 4 bytes; dropping the lead byte orphans three continuations.
		const full = Buffer.from("𝄞", "utf8")
		expect(countPartialSequenceAtStart(full.subarray(1))).toBe(3)
	})

	it("should treat a run of more than three continuation bytes as invalid data", () => {
		// No valid sequence is longer than 4 bytes, so this is not a cut sequence
		// and must be left in place to be decoded lossily rather than hidden.
		expect(countPartialSequenceAtStart(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x41]))).toBe(0)
	})
})

describe("countPartialSequenceAtEnd", () => {
	it("should report no partial sequence for a complete buffer", () => {
		expect(countPartialSequenceAtEnd(Buffer.from("héllo", "utf8"))).toBe(0)
	})

	it("should count a lead byte whose sequence extends past the end", () => {
		const full = Buffer.from("é", "utf8")
		expect(countPartialSequenceAtEnd(full.subarray(0, 1))).toBe(1)
	})

	it("should count a partially present 4-byte sequence", () => {
		const full = Buffer.from("𝄞", "utf8")
		expect(countPartialSequenceAtEnd(full.subarray(0, 3))).toBe(3)
	})

	it("should not trim a complete multi-byte sequence at the end", () => {
		expect(countPartialSequenceAtEnd(Buffer.from("aé", "utf8"))).toBe(0)
	})
})

// ─── readByteWindow ───────────────────────────────────────────────────────────

describe("readByteWindow", () => {
	it("should read from an offset", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const result = await readByteWindow(filePath, { offset: 3, limit: 4 })

		expect(result.content).toBe("3456")
		expect(result.startOffset).toBe(3)
		expect(result.endOffset).toBe(7)
		expect(result.totalBytes).toBe(10)
		expect(result.hasMoreAfter).toBe(true)
	})

	it("should read to the end of the file", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const result = await readByteWindow(filePath, { offset: 6, limit: 100 })

		expect(result.content).toBe("6789")
		expect(result.endOffset).toBe(10)
		expect(result.hasMoreAfter).toBe(false)
	})

	it("should treat an offset past EOF as the end of paging, not an error", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const result = await readByteWindow(filePath, { offset: 50, limit: 10 })

		// Returning an empty window rather than an error means a caller can follow
		// reported offsets to the end without special-casing the last read.
		expect(result.content).toBe("")
		expect(result.totalBytes).toBe(10)
		expect(result.hasMoreAfter).toBe(false)
	})

	it("should handle a zero-length window", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const result = await readByteWindow(filePath, { offset: 2, limit: 0 })

		expect(result.content).toBe("")
		expect(result.hasMoreAfter).toBe(true)
	})

	it("should handle an empty file", async () => {
		const filePath = await writeFixture("empty.txt", "")

		const result = await readByteWindow(filePath, { offset: 0 })

		expect(result.content).toBe("")
		expect(result.totalBytes).toBe(0)
		expect(result.hasMoreAfter).toBe(false)
	})

	it("should clamp the limit to MAX_BYTE_LIMIT", async () => {
		const filePath = await writeFixture("plain.txt", "x".repeat(100))

		const result = await readByteWindow(filePath, { offset: 0, limit: MAX_BYTE_LIMIT * 10 })

		// Clamping matters because the window is held in memory and sent to a model.
		expect(result.content.length).toBe(100)
	})

	it("should default the limit to DEFAULT_BYTE_LIMIT", async () => {
		const filePath = await writeFixture("big.txt", "x".repeat(DEFAULT_BYTE_LIMIT + 500))

		const result = await readByteWindow(filePath, { offset: 0 })

		expect(result.endOffset).toBe(DEFAULT_BYTE_LIMIT)
		expect(result.hasMoreAfter).toBe(true)
	})

	describe("partial UTF-8 sequences at the window edges", () => {
		it("should trim and report a sequence cut by the window start", async () => {
			const filePath = await writeFixture("utf8.txt", "aéb")

			// "é" occupies bytes 1-2; starting at 2 lands inside it.
			const result = await readByteWindow(filePath, { offset: 2, limit: 10 })

			expect(result.partialBytesTrimmedAtStart).toBe(1)
			expect(result.content).toBe("b")
			// A U+FFFD here would be indistinguishable from one in the file itself.
			expect(result.content).not.toContain("\uFFFD")
		})

		it("should trim and report a sequence cut by the window end", async () => {
			const filePath = await writeFixture("utf8.txt", "aéb")

			// Window covers "a" plus the first byte of "é".
			const result = await readByteWindow(filePath, { offset: 0, limit: 2 })

			expect(result.partialBytesTrimmedAtEnd).toBe(1)
			expect(result.content).toBe("a")
			expect(result.content).not.toContain("\uFFFD")
		})

		it("should keep a trailing partial sequence at EOF", async () => {
			// At EOF an incomplete sequence is genuinely malformed data, not a
			// windowing artefact, so hiding it would misrepresent the file.
			const filePath = await writeFixture("truncated.bin", Buffer.from([0x61, 0xc3]))

			const result = await readByteWindow(filePath, { offset: 0, limit: 10 })

			expect(result.partialBytesTrimmedAtEnd).toBe(0)
			expect(result.replacementCharCount).toBe(1)
		})

		it("should report the window it actually read, including trimmed bytes", async () => {
			const filePath = await writeFixture("utf8.txt", "aéb")

			const result = await readByteWindow(filePath, { offset: 0, limit: 2 })

			// endOffset covers the bytes read from disk, so following it as the next
			// offset does not re-read or skip the trimmed byte.
			expect(result.endOffset).toBe(2)
		})
	})

	it("should count U+FFFD from invalid bytes", async () => {
		const filePath = await writeFixture("invalid.bin", Buffer.from([0x61, 0xff, 0xfe, 0x62]))

		const result = await readByteWindow(filePath, { offset: 0, limit: 10 })

		expect(result.replacementCharCount).toBe(2)
	})

	it("should report the line number containing the window start", async () => {
		const filePath = await writeFixture("lines.txt", "one\ntwo\nthree\n")

		// Byte 8 is the start of "three".
		const result = await readByteWindow(filePath, { offset: 8, limit: 5 })

		expect(result.content).toBe("three")
		expect(result.startLineNumber).toBe(3)
	})

	it("should count CRLF line endings correctly", async () => {
		const filePath = await writeFixture("crlf.txt", "one\r\ntwo\r\nthree")

		const result = await readByteWindow(filePath, { offset: 10, limit: 5 })

		expect(result.startLineNumber).toBe(3)
	})
})

// ─── formatByteReadResult ─────────────────────────────────────────────────────

describe("formatByteReadResult", () => {
	it("should state the window inclusively and name the next call", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const output = formatByteReadResult(await readByteWindow(filePath, { offset: 2, limit: 4 }))

		// Inclusive end (5, not 6) so it matches the truncation markers, which name
		// a first and last omitted byte.
		expect(output).toContain("Bytes 2-5 of 10")
		expect(output).toContain("bytes_as_utf8.offset=6")
		expect(output).toContain("2345")
	})

	it("should omit the continuation hint at end of file", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const output = formatByteReadResult(await readByteWindow(filePath, { offset: 0, limit: 100 }))

		expect(output).not.toContain("To read more")
	})

	it("should report trimmed partial sequences", async () => {
		const filePath = await writeFixture("utf8.txt", "aéb")

		const output = formatByteReadResult(await readByteWindow(filePath, { offset: 2, limit: 10 }))

		expect(output).toContain("partial UTF-8 sequence trimmed at start")
	})

	it("should report replacement characters so they are not mistaken for a cut", async () => {
		const filePath = await writeFixture("invalid.bin", Buffer.from([0x61, 0xff, 0x62]))

		const output = formatByteReadResult(await readByteWindow(filePath, { offset: 0, limit: 10 }))

		expect(output).toContain("U+FFFD")
	})

	it("should say when the offset is past end of file", async () => {
		const filePath = await writeFixture("plain.txt", "0123456789")

		const output = formatByteReadResult(await readByteWindow(filePath, { offset: 99, limit: 10 }))

		expect(output).toContain("at or past end of file")
	})
})

// ─── Regression: content past the per-line cap is reachable ───────────────────

describe("reading past the per-line display cap", () => {
	// The bug this feature fixes: with a line longer than the per-line cap, the
	// tail was unreachable with any combination of parameters. `offset`/`limit`
	// select whole lines and never a byte range, so the only address for that
	// tail is a byte offset.
	// Placed to end at byte 1985, comfortably inside the 2000-byte cap. A marker
	// straddling the cut would be sliced in half and match neither assertion,
	// which says nothing about whether the tail is reachable.
	const MARKER_EARLY = "MARKER_AT_1970_"
	const MARKER_LATE = "MARKER_AT_3005_END"

	/** Line 2 is exactly 3023 bytes: one marker inside the cap, one beyond it. */
	function buildFixture(): string {
		const filler = (n: number) => "A".repeat(n)
		const line2 =
			filler(1970) + // 0-1969
			MARKER_EARLY + // 1970-1984, inside the 2000-byte cap
			filler(3005 - 1970 - MARKER_EARLY.length) + // 1985-3004
			MARKER_LATE // 3005-3022, unreachable without byte addressing
		return `line one\n${line2}\nline three\n`
	}

	it("should build a fixture with the intended geometry", () => {
		// Guards the assertions below: if this arithmetic drifts, the markers stop
		// straddling the cap in the way the other tests assume.
		const line2 = buildFixture().split("\n")[1]
		expect(line2.length).toBe(3023)
		expect(line2.indexOf(MARKER_EARLY)).toBe(1970)
		expect(line2.indexOf(MARKER_LATE)).toBe(3005)
	})

	it("should truncate the long line but keep the early marker", () => {
		const content = buildFixture()

		const result = readWithSlice(Buffer.from(content, "utf8"), 1, 1)

		expect(result.content).toContain(MARKER_EARLY)
		expect(result.content).not.toContain(MARKER_LATE)
		expect(result.truncatedLines).toHaveLength(1)
	})

	it("should make the far marker reachable via the offset the marker reports", async () => {
		const content = buildFixture()
		const filePath = await writeFixture("long-line.txt", content)

		// Read as an agent would: line mode first, which truncates.
		const sliced = readWithSlice(Buffer.from(content, "utf8"), 1, 1)
		const [truncation] = sliced.truncatedLines

		// Then follow the byte offset the marker reported. This is the round trip
		// that the bug made impossible.
		const byteResult = await readByteWindow(filePath, {
			offset: truncation.omittedStartOffset,
			limit: truncation.omittedBytes,
		})

		expect(byteResult.content).toContain(MARKER_LATE)
	})

	it("should report an omitted range whose endpoints agree with the byte count", () => {
		const content = buildFixture()

		const [truncation] = readWithSlice(Buffer.from(content, "utf8"), 1, 1).truncatedLines

		expect(truncation.omittedEndOffset - truncation.omittedStartOffset + 1).toBe(truncation.omittedBytes)
		// Line 2 starts after "line one\n" (9 bytes) and is 3023 bytes long.
		expect(truncation.lineByteLength).toBe(3023)
		expect(truncation.omittedEndOffset).toBe(9 + 3023 - 1)
	})

	it("should report offsets that survive invalid UTF-8 earlier in the file", async () => {
		// The trap this guards: decoding before measuring maps each invalid byte to
		// U+FFFD, which re-encodes to 3 bytes where the original was 1, so every
		// offset after it drifts. Offsets must come from the buffer.
		const prefix = Buffer.from([0x61, 0xff, 0x0a]) // "a", invalid byte, newline
		const longLine = Buffer.from("B".repeat(2500) + MARKER_LATE, "utf8")
		const content = Buffer.concat([prefix, longLine, Buffer.from("\n")])
		const filePath = await writeFixture("invalid-prefix.txt", content)

		const [truncation] = readWithSlice(content, 1, 1).truncatedLines

		// The long line starts at byte 3, immediately after the 3-byte prefix.
		expect(truncation.omittedStartOffset).toBe(3 + 2000)

		const byteResult = await readByteWindow(filePath, {
			offset: truncation.omittedStartOffset,
			limit: truncation.omittedBytes,
		})
		expect(byteResult.content).toContain(MARKER_LATE)
	})
})
