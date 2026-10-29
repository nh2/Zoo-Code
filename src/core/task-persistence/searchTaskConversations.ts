import * as fs from "fs/promises"
import * as path from "path"

import type { TaskConversationMatch } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"

const SNIPPET_CONTEXT_BEFORE = 60
const SNIPPET_CONTEXT_AFTER = 140
const READ_CONCURRENCY = 16

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ")
}

/**
 * Whether the query contains none of the characters that `JSON.stringify` escapes.
 * Then it appears verbatim in the raw file, so the raw text can be checked
 * before paying for `JSON.parse`.
 */
function canPrefilterRawJson(query: string): boolean {
	for (let i = 0; i < query.length; i++) {
		const code = query.charCodeAt(i)
		if (code < 0x20 || query[i] === '"' || query[i] === "\\") {
			return false
		}
	}
	return true
}

type Snippet = Omit<TaskConversationMatch, "taskId" | "matchCount">

function buildSnippet(text: string, matchIndex: number, matchLength: number): Snippet {
	const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_BEFORE)
	const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_CONTEXT_AFTER)
	const before = (start > 0 ? "…" : "") + collapseWhitespace(text.slice(start, matchIndex)).trimStart()
	const match = collapseWhitespace(text.slice(matchIndex, matchIndex + matchLength))
	const after =
		collapseWhitespace(text.slice(matchIndex + matchLength, end)).trimEnd() + (end < text.length ? "…" : "")
	return {
		snippet: before + match + after,
		snippetMatchStart: before.length,
		snippetMatchLength: match.length,
	}
}

function searchMessages(taskId: string, messages: unknown[], pattern: RegExp): TaskConversationMatch | undefined {
	let matchCount = 0
	let first: Snippet | undefined

	for (const message of messages) {
		if (!message || typeof message !== "object") {
			continue
		}
		const { text, reasoning } = message as { text?: unknown; reasoning?: unknown }
		for (const field of [text, reasoning]) {
			if (typeof field !== "string" || field.length === 0) {
				continue
			}
			for (const match of field.matchAll(pattern)) {
				matchCount++
				first ??= buildSnippet(field, match.index, match[0].length)
			}
		}
	}

	return first ? { taskId, matchCount, ...first } : undefined
}

async function searchTask(tasksDir: string, taskId: string, pattern: RegExp, prefilter: RegExp | undefined) {
	if (!taskId || taskId === "." || taskId === ".." || path.basename(taskId) !== taskId) {
		return undefined
	}

	let raw: string
	try {
		raw = await fs.readFile(path.join(tasksDir, taskId, GlobalFileNames.uiMessages), "utf8")
	} catch {
		return undefined
	}

	if (prefilter && !prefilter.test(raw)) {
		return undefined
	}

	let messages: unknown
	try {
		messages = JSON.parse(raw)
	} catch {
		return undefined
	}

	return Array.isArray(messages) ? searchMessages(taskId, messages, pattern) : undefined
}

/**
 * Case-insensitive substring search over the full `ui_messages.json` of each given task.
 * Results keep the order of `taskIds`; tasks without a match are omitted.
 */
export async function searchTaskConversations(
	tasksDir: string,
	taskIds: readonly string[],
	query: string,
): Promise<TaskConversationMatch[]> {
	const trimmed = query.trim()
	if (!trimmed) {
		return []
	}

	const source = escapeRegExp(trimmed)
	// `matchAll` clones the regex, so sharing one global pattern across workers is safe.
	const pattern = new RegExp(source, "giu")
	const prefilter = canPrefilterRawJson(trimmed) ? new RegExp(source, "iu") : undefined
	const results: (TaskConversationMatch | undefined)[] = new Array(taskIds.length)

	let next = 0
	const worker = async () => {
		while (next < taskIds.length) {
			const index = next++
			results[index] = await searchTask(tasksDir, taskIds[index], pattern, prefilter)
		}
	}
	await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, taskIds.length) }, worker))

	return results.filter((result): result is TaskConversationMatch => result !== undefined)
}
