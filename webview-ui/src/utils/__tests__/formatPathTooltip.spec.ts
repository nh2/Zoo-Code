import { formatPathTooltip } from "../formatPathTooltip"

describe("formatPathTooltip", () => {
	it("returns an empty string for a missing path", () => {
		expect(formatPathTooltip(undefined)).toBe("")
		expect(formatPathTooltip("")).toBe("")
	})

	it.each(["/path/to/file", "./src/index.ts", ".roo/rules.md", "C:\\Users\\me", "\\\\server\\share"])(
		"keeps leading characters of %s",
		(path) => {
			expect(formatPathTooltip(path)).toBe(path + "\u200E")
		},
	)

	it("appends additional content after the path", () => {
		expect(formatPathTooltip("/path/to/file", "reason")).toBe("/path/to/file\u200E reason")
	})
})
