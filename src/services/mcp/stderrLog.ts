import * as vscode from "vscode"

import { Package } from "../../shared/package"

export type StderrLevel = "error" | "warn" | "info"

export const MAX_STDERR_ENTRY_LENGTH = 4000
export const STDERR_TAIL_LINES = 50

/**
 * Splits a stream of stderr chunks into whole lines.
 * A trailing partial line is held back until the next chunk or `flush()`.
 */
export class StderrLineSplitter {
	private pending = ""

	push(chunk: string): string[] {
		const lines = (this.pending + chunk).split(/\r?\n/)
		this.pending = lines.pop() ?? ""
		return lines
	}

	flush(): string[] {
		const rest = this.pending
		this.pending = ""
		return rest.length > 0 ? [rest] : []
	}
}

export function classifyStderrLine(line: string): StderrLevel {
	if (/\b(INFO|DEBUG|TRACE)\b/i.test(line)) {
		return "info"
	}
	if (/\bWARN(ING)?\b/i.test(line)) {
		return "warn"
	}
	return "error"
}

/** Groups consecutive lines of the same level, so a traceback becomes one entry. */
export function groupStderrLines(lines: string[]): { level: StderrLevel; text: string }[] {
	const groups: { level: StderrLevel; lines: string[] }[] = []
	for (const line of lines) {
		if (line.trim() === "") {
			continue
		}
		const level = classifyStderrLine(line)
		const last = groups.at(-1)
		if (last && last.level === level) {
			last.lines.push(line)
		} else {
			groups.push({ level, lines: [line] })
		}
	}
	return groups.map(({ level, lines }) => ({ level, text: lines.join("\n") }))
}

/** Keeps the end of `text`, where a traceback has its exception line. */
export function truncateKeepingTail(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text
	}
	return `...(truncated)\n${text.slice(text.length - maxLength)}`
}

let mcpOutputChannel: vscode.OutputChannel | undefined

export function getMcpOutputChannel(): vscode.OutputChannel {
	mcpOutputChannel ??= vscode.window.createOutputChannel(`${Package.outputChannel} MCP`)
	return mcpOutputChannel
}

export function logMcpServerEvent(serverName: string, message: string): void {
	const timestamp = new Date().toISOString()
	const prefix = `[${timestamp}] [${serverName}] `
	getMcpOutputChannel().appendLine(
		message
			.split("\n")
			.map((line) => prefix + line)
			.join("\n"),
	)
}

export function showMcpOutputChannel(): void {
	getMcpOutputChannel().show(true)
}
