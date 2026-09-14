/**
 * Byte-window file reading, decoded as UTF-8.
 *
 * This exists so that content which is unreachable by line-oriented reading can
 * still be retrieved. A line reader can only ever select *whole lines*, so any
 * content past the per-line display cap on a very long line (machine-generated
 * JSON, minified assets, CSV exports, log lines) has no line-based address at
 * all. A byte window does, and every truncation marker emitted elsewhere points
 * back here by byte offset.
 *
 * Offsets are 0-based byte offsets into the file, inclusive of `offset` and
 * exclusive of `offset + limit`. Bytes are the unit rather than characters
 * because they are the only unit that survives a lossy UTF-8 decode: replacing
 * one invalid byte with U+FFFD grows the re-encoded text by two bytes, so any
 * offset derived from decoded text drifts on exactly the malformed files this
 * reader is meant to rescue.
 */

import * as fs from "fs/promises"

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default number of bytes to read when no limit is given (40KB, matching read_command_output) */
export const DEFAULT_BYTE_LIMIT = 40 * 1024

/** Hard cap on a single byte-window read, to bound context consumption (1MB) */
export const MAX_BYTE_LIMIT = 1024 * 1024

/** Chunk size used when counting newlines before an offset */
const NEWLINE_SCAN_CHUNK_SIZE = 64 * 1024

/** The Unicode replacement character, produced by a lossy UTF-8 decode */
const REPLACEMENT_CHAR = "\uFFFD"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ByteReadOptions {
	/** 0-based byte offset to start reading from (default: 0) */
	offset?: number
	/** Maximum bytes to read (default: DEFAULT_BYTE_LIMIT, capped at MAX_BYTE_LIMIT) */
	limit?: number
}

export interface ByteReadResult {
	/** The decoded content of the window */
	content: string
	/** Total size of the file in bytes */
	totalBytes: number
	/** First byte offset of the window that was read (0-based, inclusive) */
	startOffset: number
	/**
	 * One past the last byte offset of the window that was read.
	 * `endOffset - startOffset` is the number of bytes read, including any bytes
	 * that were trimmed from the edges as partial UTF-8 sequences.
	 */
	endOffset: number
	/** Bytes trimmed from the start of the window because they continued a sequence begun before it */
	partialBytesTrimmedAtStart: number
	/** Bytes trimmed from the end of the window because they began a sequence completed after it */
	partialBytesTrimmedAtEnd: number
	/**
	 * Count of U+FFFD replacement characters in `content`.
	 *
	 * These may be genuine U+FFFD characters present in the file, or bytes that
	 * are not valid UTF-8 at all. Either way, reporting the count lets a caller
	 * distinguish "the file contains this" from "the window cut something".
	 */
	replacementCharCount: number
	/** Whether there are more bytes after this window */
	hasMoreAfter: boolean
	/** 1-based line number containing `startOffset` */
	startLineNumber: number
}

// ─── UTF-8 Boundary Helpers ───────────────────────────────────────────────────

/**
 * Whether `byte` is a UTF-8 continuation byte (0b10xxxxxx).
 */
function isContinuationByte(byte: number): boolean {
	return (byte & 0xc0) === 0x80
}

/**
 * Expected total length of the UTF-8 sequence started by `byte`,
 * or 0 if `byte` does not start a multi-byte sequence.
 */
function sequenceLength(byte: number): number {
	if ((byte & 0x80) === 0x00) return 1 // 0xxxxxxx
	if ((byte & 0xe0) === 0xc0) return 2 // 110xxxxx
	if ((byte & 0xf0) === 0xe0) return 3 // 1110xxxx
	if ((byte & 0xf8) === 0xf0) return 4 // 11110xxx
	return 0 // continuation byte or invalid lead byte
}

/**
 * Count leading bytes of `buffer` that continue a UTF-8 sequence which began
 * before the buffer, and so cannot be decoded here.
 *
 * A well-formed sequence is at most 4 bytes, so at most 3 continuation bytes can
 * be orphaned this way. Anything beyond that is not a truncated sequence but
 * invalid data, which we leave in place to be decoded lossily rather than hiding
 * it from the caller.
 */
export function countPartialSequenceAtStart(buffer: Buffer): number {
	let count = 0
	while (count < buffer.length && count < 3 && isContinuationByte(buffer[count])) {
		count++
	}
	// A run of continuation bytes longer than 3 is invalid data, not a cut sequence.
	if (count === 3 && buffer.length > 3 && isContinuationByte(buffer[3])) {
		return 0
	}
	return count
}

/**
 * Count trailing bytes of `buffer` that begin a UTF-8 sequence extending past
 * the end of the buffer, and so cannot be decoded here.
 */
export function countPartialSequenceAtEnd(buffer: Buffer): number {
	// Walk back over at most 3 continuation bytes to find the lead byte.
	let i = buffer.length - 1
	let continuations = 0

	while (i >= 0 && continuations < 3 && isContinuationByte(buffer[i])) {
		continuations++
		i--
	}

	if (i < 0) return 0

	const expected = sequenceLength(buffer[i])
	// Not a lead byte, or a complete sequence: nothing to trim.
	if (expected <= 1) return 0

	const available = continuations + 1
	return available < expected ? available : 0
}

// ─── Line Number Helper ───────────────────────────────────────────────────────

/**
 * Count newlines before `offset` to report the 1-based line number of a window.
 *
 * Reads in fixed chunks rather than allocating a buffer of size `offset`, so
 * that a byte read far into a large file stays cheap in memory.
 *
 * TODO(perf, unbenchmarked): this counts byte by byte in JS, so it is O(offset)
 * in interpreted iterations — and `offset` is largest in exactly the case this
 * module exists for, paging deep into a big file. `buffer.indexOf(0x0a, pos)` in
 * a loop would push the scan into native memchr, with JS iterations proportional
 * to the newline count instead. Safe across the chunk boundaries used here
 * because 0x0A is single-byte and cannot straddle one. The identical loop exists
 * in `ReadCommandOutputTool.countNewlinesBeforeOffset()`; fix both together.
 * Deferred until the feature is confirmed useful, then benchmark before changing.
 */
async function countLineNumberAtOffset(handle: fs.FileHandle, offset: number): Promise<number> {
	let lineNumber = 1
	let scanned = 0
	const buffer = Buffer.alloc(Math.min(NEWLINE_SCAN_CHUNK_SIZE, Math.max(offset, 1)))

	while (scanned < offset) {
		const toRead = Math.min(buffer.length, offset - scanned)
		const { bytesRead } = await handle.read(buffer, 0, toRead, scanned)
		if (bytesRead <= 0) break

		for (let i = 0; i < bytesRead; i++) {
			if (buffer[i] === 0x0a) lineNumber++
		}
		scanned += bytesRead
	}

	return lineNumber
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Read a byte window of a file and decode it as UTF-8.
 *
 * Reads positionally rather than loading the file, so that a file far larger
 * than the window (or than memory) can still be paged through.
 *
 * @param filePath - Absolute path to the file to read
 * @param options - Byte window to read
 * @returns The decoded window plus the metadata needed to page further
 */
export async function readByteWindow(filePath: string, options: ByteReadOptions = {}): Promise<ByteReadResult> {
	const requestedOffset = Math.max(0, Math.floor(options.offset ?? 0))
	const requestedLimit = Math.min(MAX_BYTE_LIMIT, Math.max(0, Math.floor(options.limit ?? DEFAULT_BYTE_LIMIT)))

	const handle = await fs.open(filePath, "r")

	try {
		const stats = await handle.stat()
		const totalBytes = stats.size

		// Reading at or past EOF is not an error: it is the natural end of paging
		// through a file, and callers page by following reported offsets.
		if (requestedOffset >= totalBytes || requestedLimit === 0) {
			const startLineNumber = await countLineNumberAtOffset(handle, Math.min(requestedOffset, totalBytes))
			return {
				content: "",
				totalBytes,
				startOffset: Math.min(requestedOffset, totalBytes),
				endOffset: Math.min(requestedOffset, totalBytes),
				partialBytesTrimmedAtStart: 0,
				partialBytesTrimmedAtEnd: 0,
				replacementCharCount: 0,
				hasMoreAfter: requestedOffset < totalBytes,
				startLineNumber,
			}
		}

		const windowLength = Math.min(requestedLimit, totalBytes - requestedOffset)
		const buffer = Buffer.alloc(windowLength)
		const { bytesRead } = await handle.read(buffer, 0, windowLength, requestedOffset)
		const window = buffer.subarray(0, bytesRead)

		const startOffset = requestedOffset
		const endOffset = requestedOffset + bytesRead

		// Trim bytes belonging to sequences that straddle the window edges. They
		// would otherwise decode to U+FFFD and be indistinguishable from
		// replacement characters genuinely present in the file.
		const trimmedAtStart = countPartialSequenceAtStart(window)
		// Only trim at the end if more bytes follow; at EOF a partial sequence is
		// genuinely malformed data and belongs in the output.
		const trimmedAtEnd = endOffset < totalBytes ? countPartialSequenceAtEnd(window) : 0

		const decodable = window.subarray(trimmedAtStart, window.length - trimmedAtEnd)
		const content = decodable.toString("utf8")

		// TODO(perf, unbenchmarked): unlike the newline scans, this cannot become a
		// native buffer scan: it walks the *decoded string*, so `Buffer.indexOf`
		// does not apply. The native string alternatives both allocate an array
		// proportional to the match count (`split(REPLACEMENT_CHAR).length - 1`,
		// `match(/\uFFFD/g)?.length`); a bounded `String.indexOf` loop would not.
		// Lowest priority of the three scans, since it is bounded by the window
		// (<= MAX_BYTE_LIMIT) rather than by the file size. Benchmark first.
		let replacementCharCount = 0
		for (let i = 0; i < content.length; i++) {
			if (content[i] === REPLACEMENT_CHAR) replacementCharCount++
		}

		const startLineNumber = await countLineNumberAtOffset(handle, startOffset)

		return {
			content,
			totalBytes,
			startOffset,
			endOffset,
			partialBytesTrimmedAtStart: trimmedAtStart,
			partialBytesTrimmedAtEnd: trimmedAtEnd,
			replacementCharCount,
			hasMoreAfter: endOffset < totalBytes,
			startLineNumber,
		}
	} finally {
		await handle.close()
	}
}

/**
 * Format a byte-window read for presentation to a model.
 *
 * States the window in the same units the caller passes in, so that the next
 * call can be made without arithmetic, and names every way the content differs
 * from the raw bytes.
 */
export function formatByteReadResult(result: ByteReadResult): string {
	const notes: string[] = []

	if (result.partialBytesTrimmedAtStart > 0) {
		const plural = result.partialBytesTrimmedAtStart === 1 ? "byte" : "bytes"
		notes.push(
			`${result.partialBytesTrimmedAtStart} ${plural} of a partial UTF-8 sequence trimmed at start ` +
				`(byte offset ${result.startOffset}); read from byte offset ${result.startOffset - 3} or earlier to see it whole.`,
		)
	}

	if (result.partialBytesTrimmedAtEnd > 0) {
		const plural = result.partialBytesTrimmedAtEnd === 1 ? "byte" : "bytes"
		const firstTrimmed = result.endOffset - result.partialBytesTrimmedAtEnd
		notes.push(
			`${result.partialBytesTrimmedAtEnd} ${plural} of a partial UTF-8 sequence trimmed at end ` +
				`(byte offset ${firstTrimmed}); it continues past this window.`,
		)
	}

	if (result.replacementCharCount > 0) {
		const plural = result.replacementCharCount === 1 ? "character" : "characters"
		notes.push(
			`Content contains ${result.replacementCharCount} U+FFFD replacement ${plural}: ` +
				`either present in the file or bytes that are not valid UTF-8.`,
		)
	}

	if (result.content === "" && result.startOffset >= result.totalBytes) {
		notes.push(`Byte offset ${result.startOffset} is at or past end of file (${result.totalBytes} bytes).`)
	}

	// `endOffset` is exclusive, so the last byte actually read is one before it.
	// State it inclusively to match the truncation markers, which name a first
	// and last omitted byte.
	const lastByte = result.endOffset > result.startOffset ? result.endOffset - 1 : result.startOffset
	const header =
		`Bytes ${result.startOffset}-${lastByte} of ${result.totalBytes} (decoded as UTF-8), ` +
		`starting on line ${result.startLineNumber}.`

	const continuation = result.hasMoreAfter
		? `\nTo read more: read_file with mode='bytes_as_utf8' and bytes_as_utf8.offset=${result.endOffset}.`
		: ""

	const noteBlock = notes.length > 0 ? `\n${notes.map((note) => `Note: ${note}`).join("\n")}` : ""

	return `${header}${noteBlock}${continuation}\n\n${result.content}`
}
