import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { searchTaskConversations } from "../searchTaskConversations"

describe("searchTaskConversations", () => {
	let tasksDir: string

	const writeTask = async (taskId: string, messages: unknown) => {
		const dir = path.join(tasksDir, taskId)
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(
			path.join(dir, "ui_messages.json"),
			typeof messages === "string" ? messages : JSON.stringify(messages),
		)
	}

	beforeEach(async () => {
		tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "search-task-conversations-"))
	})

	afterEach(async () => {
		await fs.rm(tasksDir, { recursive: true, force: true })
	})

	it("finds a query that only appears after the initial prompt", async () => {
		const url = "https://github.com/example/example/issues/1985"
		await writeTask("recent", [
			{ ts: 1, type: "say", say: "text", text: "Fix the bug" },
			{ ts: 2, type: "say", say: "text", text: `See ${url} for details` },
		])
		await writeTask("old", [
			{ ts: 1, type: "say", say: "text", text: "https://github.com/example/other/issues/2781 1 9 8 5" },
		])

		const results = await searchTaskConversations(tasksDir, ["old", "recent"], url)

		expect(results).toEqual([
			{
				taskId: "recent",
				matchCount: 1,
				snippet: `See ${url} for details`,
				snippetMatchStart: 4,
				snippetMatchLength: url.length,
			},
		])
	})

	it("matches case-insensitively, counts all matches, and searches reasoning", async () => {
		await writeTask("t", [
			{ ts: 1, type: "say", say: "text", text: "alpha ALPHA" },
			{ ts: 2, type: "say", say: "reasoning", reasoning: "Alpha again" },
		])

		const [result] = await searchTaskConversations(tasksDir, ["t"], "alpha")

		expect(result.matchCount).toBe(3)
		expect(
			result.snippet.slice(result.snippetMatchStart, result.snippetMatchStart + result.snippetMatchLength),
		).toBe("alpha")
	})

	it("treats regex metacharacters literally", async () => {
		await writeTask("a", [{ ts: 1, type: "say", say: "text", text: "value a.b(c)" }])
		await writeTask("b", [{ ts: 1, type: "say", say: "text", text: "value axb(c)" }])

		const results = await searchTaskConversations(tasksDir, ["a", "b"], "a.b(c)")

		expect(results.map((r) => r.taskId)).toEqual(["a"])
	})

	it("finds queries containing characters that JSON escapes", async () => {
		await writeTask("t", [{ ts: 1, type: "say", say: "text", text: 'path "C:\\dir"' }])

		const results = await searchTaskConversations(tasksDir, ["t"], '"C:\\dir"')

		expect(results).toHaveLength(1)
	})

	it("truncates long context with ellipses and collapses whitespace", async () => {
		const text = `${"x".repeat(200)}\n\n  needle  \n${"y".repeat(300)}`
		await writeTask("t", [{ ts: 1, type: "say", say: "text", text }])

		const [result] = await searchTaskConversations(tasksDir, ["t"], "needle")

		expect(result.snippet.startsWith("…")).toBe(true)
		expect(result.snippet.endsWith("…")).toBe(true)
		expect(result.snippet).not.toMatch(/\s{2,}/)
		expect(
			result.snippet.slice(result.snippetMatchStart, result.snippetMatchStart + result.snippetMatchLength),
		).toBe("needle")
	})

	it("skips missing, malformed, and non-array files, and keeps input order", async () => {
		await writeTask("broken", "{not json needle")
		await writeTask("object", { text: "needle" })
		await writeTask("second", [{ ts: 1, type: "say", say: "text", text: "needle" }])
		await writeTask("first", [{ ts: 1, type: "say", say: "text", text: "needle" }])

		const results = await searchTaskConversations(
			tasksDir,
			["first", "missing", "broken", "object", "second"],
			"needle",
		)

		expect(results.map((r) => r.taskId)).toEqual(["first", "second"])
	})

	it("ignores task ids that would escape the tasks directory", async () => {
		await writeTask("t", [{ ts: 1, type: "say", say: "text", text: "needle" }])

		const results = await searchTaskConversations(path.join(tasksDir, "sub"), ["../t", "..", "."], "needle")

		expect(results).toEqual([])
	})

	it("returns nothing for a blank query", async () => {
		await writeTask("t", [{ ts: 1, type: "say", say: "text", text: "anything" }])

		expect(await searchTaskConversations(tasksDir, ["t"], "   ")).toEqual([])
	})
})
