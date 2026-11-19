// npx vitest run core/task/__tests__/TaskCommandAllowlist.spec.ts

import { TaskCommandAllowlist } from "../TaskCommandAllowlist"

const ENTRY = { command: "./deploy.sh staging", cwd: "/srv/app" }

describe("TaskCommandAllowlist", () => {
	it("matches the exact command and working directory", () => {
		const list = new TaskCommandAllowlist([ENTRY])

		expect(list.has({ ...ENTRY })).toBe(true)
	})

	it.each([
		["a different argument", { ...ENTRY, command: "./deploy.sh production" }],
		["a prefix", { ...ENTRY, command: "./deploy.sh" }],
		["an extension", { ...ENTRY, command: "./deploy.sh staging && rm -rf /" }],
		["changed whitespace", { ...ENTRY, command: "./deploy.sh  staging" }],
		["another working directory", { ...ENTRY, cwd: "/srv/other" }],
	])("does not match %s", (_label, candidate) => {
		const list = new TaskCommandAllowlist([ENTRY])

		expect(list.has(candidate)).toBe(false)
	})

	it("adds each entry once and reports whether it changed", () => {
		const list = new TaskCommandAllowlist()

		expect(list.add(ENTRY)).toBe(true)
		expect(list.add({ ...ENTRY })).toBe(false)
		expect(list.list()).toEqual([ENTRY])
	})

	it("removes an entry and reports whether it was present", () => {
		const list = new TaskCommandAllowlist([ENTRY])

		expect(list.remove({ ...ENTRY })).toBe(true)
		expect(list.remove(ENTRY)).toBe(false)
		expect(list.has(ENTRY)).toBe(false)
	})

	it("de-duplicates persisted entries", () => {
		expect(new TaskCommandAllowlist([ENTRY, { ...ENTRY }]).list()).toEqual([ENTRY])
	})

	it("does not hand out its internal entries", () => {
		const list = new TaskCommandAllowlist([ENTRY])

		list.list()[0].command = "rm -rf /"

		expect(list.has(ENTRY)).toBe(true)
	})

	describe("toPersisted", () => {
		it("is undefined for a task that never allowed a command", () => {
			expect(new TaskCommandAllowlist().toPersisted()).toBeUndefined()
		})

		it("is the current list once a command was allowed", () => {
			const list = new TaskCommandAllowlist()
			list.add(ENTRY)

			expect(list.toPersisted()).toEqual([ENTRY])
		})

		it.each([
			["added in this session", () => new TaskCommandAllowlist()],
			["restored from history", () => new TaskCommandAllowlist([ENTRY])],
		])("is an empty list after revoking the last entry %s", (_label, create) => {
			const list = create()
			list.add(ENTRY)
			list.remove(ENTRY)

			// An empty list (not `undefined`) is what overwrites the stored one.
			expect(list.toPersisted()).toEqual([])
		})
	})
})
