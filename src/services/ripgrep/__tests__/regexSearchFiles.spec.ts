import type { ChildProcess } from "child_process"
import { EventEmitter } from "events"
import { Readable } from "stream"

vi.mock("vscode", () => ({ env: { appRoot: "/mock/app/root" } }))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("child_process", () => ({ spawn: vi.fn() }))

import * as childProcess from "child_process"
import { regexSearchFiles, type RegexSearchOptions } from "../index"

function fakeRipgrepProcess(): ChildProcess {
	const proc = Object.assign(new EventEmitter(), {
		stdout: Readable.from([]),
		stderr: new EventEmitter(),
		kill: vi.fn(),
	})
	// Only the members execRipgrep touches are provided.
	return proc as unknown as ChildProcess
}

async function ripgrepArgsFor(options?: RegexSearchOptions): Promise<readonly string[]> {
	await regexSearchFiles("/ws", "/ws/notes", "TODO", undefined, undefined, options)
	return vi.mocked(childProcess.spawn).mock.calls[0][1] ?? []
}

describe("regexSearchFiles gitignore handling", () => {
	beforeEach(() => {
		vi.mocked(childProcess.spawn).mockReset()
		vi.mocked(childProcess.spawn).mockImplementation(() => fakeRipgrepProcess())
	})

	it("respects .gitignore by default", async () => {
		expect(await ripgrepArgsFor()).not.toContain("--no-ignore-vcs")
	})

	it("respects .gitignore when includeGitignored is false", async () => {
		expect(await ripgrepArgsFor({ includeGitignored: false })).not.toContain("--no-ignore-vcs")
	})

	it("searches gitignored files when includeGitignored is true", async () => {
		const args = await ripgrepArgsFor({ includeGitignored: true })

		expect(args).toContain("--no-ignore-vcs")
		// The search path must stay the final, positional argument.
		expect(args.at(-1)).toBe("/ws/notes")
	})
})
