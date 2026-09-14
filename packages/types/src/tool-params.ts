/**
 * Tool parameter type definitions for native protocol
 */

/**
 * Read mode for the read_file tool.
 * - "slice": Simple offset/limit reading (default)
 * - "indentation": Semantic block extraction based on code structure
 * - "bytes_as_utf8": Raw byte window, decoded as UTF-8
 *
 * The mode name spells out the decode because the output of a byte window is
 * not byte-exact for arbitrary binary content: invalid bytes become U+FFFD.
 * This leaves the name "bytes" free for a future mode that renders bytes
 * verbatim (for example as hex) without the ambiguity of a mode called
 * "bytes" that silently decodes.
 */
export type ReadFileMode = "slice" | "indentation" | "bytes_as_utf8"

/**
 * Indentation-mode configuration for the read_file tool.
 */
export interface IndentationParams {
	/** 1-based line number to anchor indentation extraction (defaults to offset) */
	anchor_line?: number
	/** Maximum indentation levels to include above anchor (0 = unlimited) */
	max_levels?: number
	/** Include sibling blocks at the same indentation level */
	include_siblings?: boolean
	/** Include file header (imports, comments at top) */
	include_header?: boolean
	/** Hard cap on lines returned for indentation mode */
	max_lines?: number
}

/**
 * Byte-window configuration for the read_file tool.
 *
 * Kept in its own object rather than reusing the top-level `offset`/`limit`
 * because those are 1-based *line* numbers. Silently changing their unit based
 * on `mode` is how a caller ends up reading byte 1500 when it meant line 1500.
 */
export interface BytesAsUtf8Params {
	/** 0-based byte offset to start reading from (default: 0) */
	offset?: number
	/** Maximum number of bytes to read (default: 40960) */
	limit?: number
}

/**
 * Parameters for the read_file tool (new format).
 *
 * NOTE: This is the canonical, single-file-per-call shape.
 */
export interface ReadFileParams {
	/** Path to the file, relative to workspace */
	path: string
	/** Reading mode: "slice" (default), "indentation", or "bytes_as_utf8" */
	mode?: ReadFileMode
	/**
	 * 1-based *line* number to start reading from (slice mode, default: 1).
	 * Ignored when mode === "bytes_as_utf8".
	 */
	offset?: number
	/**
	 * Maximum number of *lines* to read (default: 2000).
	 * Ignored when mode === "bytes_as_utf8".
	 */
	limit?: number
	/** Indentation-mode configuration (only used when mode === "indentation") */
	indentation?: IndentationParams
	/** Byte-window configuration (only used when mode === "bytes_as_utf8") */
	bytes_as_utf8?: BytesAsUtf8Params
}

// ─── Legacy Format Types (Backward Compatibility) ─────────────────────────────

/**
 * Line range specification for legacy read_file format.
 * Represents a contiguous range of lines [start, end] (1-based, inclusive).
 */
export interface LineRange {
	start: number
	end: number
}

/**
 * File entry for legacy read_file format.
 * Supports reading multiple disjoint line ranges from a single file.
 */
export interface FileEntry {
	/** Path to the file, relative to workspace */
	path: string
	/** Optional list of line ranges to read (if omitted, reads entire file) */
	lineRanges?: LineRange[]
}

/**
 * Legacy parameters for the read_file tool (pre-refactor format).
 * Supports reading multiple files in a single call with optional line ranges.
 *
 * @deprecated Use ReadFileParams instead. This format is maintained for
 * backward compatibility with existing chat histories.
 */
export interface LegacyReadFileParams {
	/** Array of file entries to read */
	files: FileEntry[]
	/** Discriminant flag for type narrowing */
	_legacyFormat: true
}

/**
 * Union type for read_file tool parameters.
 * Supports both new single-file format and legacy multi-file format.
 */
export type ReadFileToolParams = ReadFileParams | LegacyReadFileParams

/**
 * Type guard to check if params are in legacy format.
 */
export function isLegacyReadFileParams(params: ReadFileToolParams): params is LegacyReadFileParams {
	// `NativeToolCallParser` always tags freshly parsed legacy calls with `_legacyFormat: true`.
	// The bare-`files` fallback only matters for chat history persisted before that flag was
	// introduced (commit cc86049f1) and re-hydrated on a later run. Note that params matched via
	// that fallback narrow to `LegacyReadFileParams` but leave `_legacyFormat` `undefined`, so
	// callers should branch on the presence of `files`, not on `_legacyFormat === true`.
	const hasLegacyFlag = "_legacyFormat" in params && params._legacyFormat === true
	const hasFilesArray = "files" in params && Array.isArray((params as unknown as Record<string, unknown>).files)
	return hasLegacyFlag || hasFilesArray
}

export interface Coordinate {
	x: number
	y: number
}

export interface Size {
	width: number
	height: number
}

export interface GenerateImageParams {
	prompt: string
	path: string
	image?: string
}
