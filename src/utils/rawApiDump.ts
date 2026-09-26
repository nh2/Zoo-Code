import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import crypto from "crypto"

import { getTaskDirectoryPath } from "./storage"

export const RAW_API_DUMP_FILE_NAME = "raw_api_dump.jsonl"
export const RAW_API_DUMP_OUTPUT_CHANNEL_NAME = "Zoo Code Raw API"

export type RawApiDumpKind = "request" | "event" | "error"

export interface RawApiDumpRecord {
	ts: string
	taskId: string
	requestId: string
	seq: number
	provider: string
	kind: RawApiDumpKind
	data: unknown
}

/**
 * Receives the provider's wire-level request payload and every stream event unchanged,
 * so behaviour hidden by Zoo's chunk normalisation (empty thinking blocks, signatures,
 * block order) can be inspected.
 */
export interface RawApiDump {
	request(provider: string, payload: unknown): void
	event(provider: string, event: unknown): void
	error(provider: string, error: unknown): void
	/** Resolves once every record queued so far has been written to the task file. */
	flush(): Promise<void>
}

export interface RawApiDumpOptions {
	taskId: string
	globalStoragePath: string
	toTaskFile: boolean
	toOutputChannel: boolean
}

let outputChannel: vscode.OutputChannel | undefined

function getOutputChannel(): vscode.OutputChannel {
	outputChannel ??= vscode.window.createOutputChannel(RAW_API_DUMP_OUTPUT_CHANNEL_NAME)
	return outputChannel
}

// Bedrock request payloads carry image bytes as Uint8Array, which would otherwise serialise as one key per byte.
function replacer(_key: string, value: unknown): unknown {
	if (value instanceof Uint8Array) {
		return { $binary: `${value.byteLength} bytes` }
	}
	if (value instanceof Error) {
		// Spread first: name/message/stack are non-enumerable, AWS/Anthropic error fields ($metadata, status) are not.
		return { ...value, name: value.name, message: value.message, stack: value.stack }
	}
	if (typeof value === "bigint") {
		return value.toString()
	}
	return value
}

export function serializeRawApiDumpRecord(record: RawApiDumpRecord): string {
	try {
		return JSON.stringify(record, replacer)
	} catch (error) {
		return JSON.stringify({
			...record,
			data: { $unserializable: error instanceof Error ? error.message : String(error) },
		})
	}
}

export function createRawApiDump(options: RawApiDumpOptions): RawApiDump | undefined {
	const { taskId, globalStoragePath, toTaskFile, toOutputChannel } = options

	if (!toTaskFile && !toOutputChannel) {
		return undefined
	}

	const requestId = crypto.randomUUID()
	let seq = 0
	// Appends are chained so records land in stream order; JSONL lines are appended, never rewritten.
	let writeQueue: Promise<void> = Promise.resolve()
	const filePathPromise = toTaskFile
		? getTaskDirectoryPath(globalStoragePath, taskId).then((dir) => path.join(dir, RAW_API_DUMP_FILE_NAME))
		: undefined

	const record = (provider: string, kind: RawApiDumpKind, data: unknown) => {
		const line = serializeRawApiDumpRecord({
			ts: new Date().toISOString(),
			taskId,
			requestId,
			seq: seq++,
			provider,
			kind,
			data,
		})

		if (toOutputChannel) {
			getOutputChannel().appendLine(line)
		}

		if (filePathPromise) {
			writeQueue = writeQueue
				.then(async () => fs.appendFile(await filePathPromise, line + "\n", "utf8"))
				.catch((error) => {
					console.error(
						`[rawApiDump] Failed to append to ${RAW_API_DUMP_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}`,
					)
				})
		}
	}

	return {
		request: (provider, payload) => record(provider, "request", payload),
		event: (provider, event) => record(provider, "event", event),
		error: (provider, error) => record(provider, "error", error),
		flush: () => writeQueue,
	}
}
