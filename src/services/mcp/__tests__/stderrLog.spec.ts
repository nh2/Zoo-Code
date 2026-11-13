import { StderrLineSplitter, classifyStderrLine, groupStderrLines, truncateKeepingTail } from "../stderrLog"

vi.mock("vscode", () => ({ window: { createOutputChannel: vi.fn() } }))

describe("StderrLineSplitter", () => {
	it("holds back a partial line until the next chunk", () => {
		const splitter = new StderrLineSplitter()

		expect(splitter.push("one\ntw")).toEqual(["one"])
		expect(splitter.push("o\r\nthree")).toEqual(["two"])
		expect(splitter.flush()).toEqual(["three"])
		expect(splitter.flush()).toEqual([])
	})
})

describe("classifyStderrLine", () => {
	it.each([
		["INFO: server ready", "info"],
		["2026-01-01 debug connecting", "info"],
		["WARNING: deprecated flag", "warn"],
		["OSError: [Errno 5] Input/output error", "error"],
		["no information available", "error"],
	] as const)("classifies %j as %s", (line, level) => {
		expect(classifyStderrLine(line)).toBe(level)
	})
})

describe("groupStderrLines", () => {
	it("groups consecutive lines of the same level and drops blank lines", () => {
		expect(groupStderrLines(["INFO a", "INFO b", "", "Traceback", "  frame", "INFO c"])).toEqual([
			{ level: "info", text: "INFO a\nINFO b" },
			{ level: "error", text: "Traceback\n  frame" },
			{ level: "info", text: "INFO c" },
		])
	})
})

describe("truncateKeepingTail", () => {
	it("keeps short text unchanged", () => {
		expect(truncateKeepingTail("abc", 3)).toBe("abc")
	})

	it("keeps the end of long text", () => {
		expect(truncateKeepingTail("abcdef", 3)).toBe("...(truncated)\ndef")
	})
})
