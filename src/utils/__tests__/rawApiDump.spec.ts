import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const { appendLine, createOutputChannel } = vi.hoisted(() => {
	const appendLine = vi.fn()
	return { appendLine, createOutputChannel: vi.fn(() => ({ appendLine })) }
})

vi.mock("vscode", () => ({
	window: { createOutputChannel },
}))

let taskDir: string

vi.mock("../storage", () => ({
	getTaskDirectoryPath: vi.fn(async () => taskDir),
}))

import {
	createRawApiDump,
	RAW_API_DUMP_FILE_NAME,
	RAW_API_DUMP_OUTPUT_CHANNEL_NAME,
	type RawApiDumpRecord,
} from "../rawApiDump"

async function readDump(): Promise<RawApiDumpRecord[]> {
	const content = await fs.readFile(path.join(taskDir, RAW_API_DUMP_FILE_NAME), "utf8")
	return content
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line))
}

describe("createRawApiDump", () => {
	beforeEach(async () => {
		taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "raw-api-dump-"))
		appendLine.mockClear()
	})

	afterEach(async () => {
		await fs.rm(taskDir, { recursive: true, force: true })
	})

	it("returns undefined when both destinations are disabled", () => {
		expect(
			createRawApiDump({ taskId: "t", globalStoragePath: "/g", toTaskFile: false, toOutputChannel: false }),
		).toBeUndefined()
	})

	it("appends request, events and errors to the task file in order, unchanged", async () => {
		const dump = createRawApiDump({
			taskId: "t1",
			globalStoragePath: "/g",
			toTaskFile: true,
			toOutputChannel: false,
		})!

		// An empty progress-update thinking block is exactly what the normalised stream drops.
		const emptyThinking = { contentBlockStart: { contentBlockIndex: 1, start: { reasoningContent: {} } } }
		dump.request("Bedrock", { modelId: "m", additionalModelRequestFields: { thinking: { type: "adaptive" } } })
		dump.event("Bedrock", emptyThinking)
		dump.event("Bedrock", { contentBlockDelta: { delta: { reasoningContent: { signature: "sig" } } } })
		dump.error("Bedrock", new Error("boom"))
		await dump.flush()

		const records = await readDump()
		expect(records.map((r) => [r.seq, r.kind])).toEqual([
			[0, "request"],
			[1, "event"],
			[2, "event"],
			[3, "error"],
		])
		expect(records[1].data).toEqual(emptyThinking)
		expect(records[2].data).toEqual({ contentBlockDelta: { delta: { reasoningContent: { signature: "sig" } } } })
		expect(records[3].data).toMatchObject({ name: "Error", message: "boom" })
		expect(new Set(records.map((r) => r.requestId)).size).toBe(1)
		expect(records.every((r) => r.taskId === "t1" && r.provider === "Bedrock")).toBe(true)
		expect(appendLine).not.toHaveBeenCalled()
	})

	it("appends across requests instead of overwriting, with a distinct requestId each", async () => {
		const options = { taskId: "t", globalStoragePath: "/g", toTaskFile: true, toOutputChannel: false }
		const first = createRawApiDump(options)!
		first.event("Anthropic", { type: "message_start" })
		await first.flush()
		const second = createRawApiDump(options)!
		second.event("Anthropic", { type: "message_stop" })
		await second.flush()

		const records = await readDump()
		expect(records.map((r) => r.data)).toEqual([{ type: "message_start" }, { type: "message_stop" }])
		expect(records[0].requestId).not.toBe(records[1].requestId)
	})

	it("prints one JSON line per record to the output channel only", async () => {
		const dump = createRawApiDump({
			taskId: "t",
			globalStoragePath: "/g",
			toTaskFile: false,
			toOutputChannel: true,
		})!
		dump.event("AnthropicVertex", {
			type: "content_block_start",
			content_block: { type: "thinking", thinking: "" },
		})
		await dump.flush()

		expect(createOutputChannel).toHaveBeenCalledWith(RAW_API_DUMP_OUTPUT_CHANNEL_NAME)
		expect(appendLine).toHaveBeenCalledTimes(1)
		expect(JSON.parse(appendLine.mock.calls[0][0])).toMatchObject({
			kind: "event",
			provider: "AnthropicVertex",
			data: { type: "content_block_start", content_block: { type: "thinking", thinking: "" } },
		})
		await expect(fs.access(path.join(taskDir, RAW_API_DUMP_FILE_NAME))).rejects.toThrow()
	})

	it("summarises binary payloads instead of expanding them byte by byte", async () => {
		const dump = createRawApiDump({
			taskId: "t",
			globalStoragePath: "/g",
			toTaskFile: true,
			toOutputChannel: false,
		})!
		dump.request("Bedrock", { image: { source: { bytes: new Uint8Array(1024) } } })
		await dump.flush()

		const [record] = await readDump()
		expect(record.data).toEqual({ image: { source: { bytes: { $binary: "1024 bytes" } } } })
	})
})
