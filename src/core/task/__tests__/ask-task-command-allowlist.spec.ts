// npx vitest run core/task/__tests__/ask-task-command-allowlist.spec.ts

import type { ClineMessage, ExtensionState, TaskAllowedCommand } from "@roo-code/types"

import { formatResponse } from "../../prompts/responses"
import { Task } from "../Task"

import { attachQueue, attachTurnHarness, buildTask, type ProviderStub } from "./askHarness"

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

const TASK_CWD = "/srv/app"
const ENTRY: TaskAllowedCommand = { command: "./deploy.sh staging", cwd: TASK_CWD }

function askCommand(
	task: Task,
	entry: TaskAllowedCommand,
	{ isProtected, requestsTaskAllow }: { isProtected?: boolean; requestsTaskAllow?: boolean } = {},
) {
	return task.ask("command", entry.command, false, undefined, isProtected, {
		commandCwd: entry.cwd,
		requestsTaskAllow,
	})
}

function askRows(task: Task): ClineMessage[] {
	const addToClineMessages = task["addToClineMessages"] as ReturnType<typeof vi.fn>
	return addToClineMessages.mock.calls.map(([message]) => message as ClineMessage)
}

/** Waits until the ask row is posted, i.e. the ask is pending on the user. */
async function waitForPendingRow(task: Task): Promise<ClineMessage> {
	await vi.waitFor(() => expect(askRows(task)).toHaveLength(1))
	return askRows(task)[0]
}

describe("Task.ask with the task command allow list", () => {
	let state: Partial<ExtensionState>
	let provider: ProviderStub
	let task: Task

	beforeEach(async () => {
		// Global auto-approval off: only the task allow list can approve.
		state = { autoApprovalEnabled: false }
		provider = {
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			getSkillsManager: () => undefined,
			cwd: TASK_CWD,
			getState: async () => state,
		}
		task = buildTask(provider, TASK_CWD)
		await attachQueue(task)
	})

	it("approves an allowed command without prompting", async () => {
		task.commandAllowlist.add(ENTRY)

		const result = await askCommand(task, ENTRY)

		expect(result.response).toBe("yesButtonClicked")
		expect(askRows(task)[0]).toMatchObject({ isAnswered: true, autoApprovalDecision: "approve" })
	})

	it.each([
		["another command", { ...ENTRY, command: "./deploy.sh production" }],
		["another working directory", { ...ENTRY, cwd: "/srv/other" }],
	])("prompts for %s", async (_label, candidate) => {
		task.commandAllowlist.add(ENTRY)

		const pending = askCommand(task, candidate)
		const row = await waitForPendingRow(task)
		expect(row.isAnswered).toBeUndefined()

		task.handleWebviewAskResponse("noButtonClicked")
		expect((await pending).response).toBe("noButtonClicked")
	})

	it("prompts for a protected command even when it is allowed", async () => {
		task.commandAllowlist.add(ENTRY)

		const pending = askCommand(task, ENTRY, { isProtected: true })
		expect((await waitForPendingRow(task)).isAnswered).toBeUndefined()

		task.handleWebviewAskResponse("noButtonClicked")
		await pending
	})

	it("does not override a policy denial", async () => {
		state = { autoApprovalEnabled: true, alwaysAllowExecute: true, deniedCommands: ["./deploy.sh"] }
		task.commandAllowlist.add(ENTRY)

		const result = await askCommand(task, ENTRY)

		expect(result.response).toBe("noButtonClicked")
		expect(result.autoDenyDetail?.kind).toBe("denylist")
	})

	it("leaves a queued message queued when approving an allowed command", async () => {
		const queue = task.messageQueueService
		queue.addMessage("queued feedback")
		task.commandAllowlist.add(ENTRY)

		const result = await askCommand(task, ENTRY)

		expect(result).toMatchObject({ response: "yesButtonClicked", text: undefined })
		expect(queue.messages).toHaveLength(1)
	})

	it("Run + allow for task allows the exact command and persists it", async () => {
		const pending = askCommand(task, ENTRY)
		await waitForPendingRow(task)

		task.handleWebviewAskResponse("yesButtonClicked", undefined, undefined, { allowCommandForTask: true })

		expect((await pending).response).toBe("yesButtonClicked")
		expect(task.commandAllowlist.list()).toEqual([ENTRY])
		expect(task["saveClineMessages"]).toHaveBeenCalled()

		// The next identical ask no longer prompts.
		expect((await askCommand(task, ENTRY)).response).toBe("yesButtonClicked")
		expect(askRows(task)[1]).toMatchObject({ isAnswered: true })
	})

	it.each([
		["Run", "yesButtonClicked", {}],
		["Deny with the allow flag", "noButtonClicked", { allowCommandForTask: true }],
	] as const)("%s does not allow the command", async (_label, response, options) => {
		const pending = askCommand(task, ENTRY)
		await waitForPendingRow(task)

		task.handleWebviewAskResponse(response, undefined, undefined, options)
		await pending

		expect(task.commandAllowlist.list()).toEqual([])
	})

	it.each([
		[true, true],
		[false, undefined],
		[undefined, undefined],
	])("stamps requestsTaskAllow=%s on the row as %s", async (requestsTaskAllow, expected) => {
		const pending = askCommand(task, ENTRY, { requestsTaskAllow })
		const row = await waitForPendingRow(task)

		expect(row.requestsTaskAllow).toBe(expected)

		task.handleWebviewAskResponse("noButtonClicked")
		await pending
	})

	describe("revokeAllowedCommand", () => {
		it.each([
			[true, 1],
			[false, 0],
		])("with notifyModel=%s removes the command and queues %i notice(s)", async (notifyModel, noticeCount) => {
			task.commandAllowlist.add(ENTRY)

			await task.revokeAllowedCommand({ ...ENTRY }, { notifyModel })

			expect(task.commandAllowlist.has(ENTRY)).toBe(false)
			expect(task["saveClineMessages"]).toHaveBeenCalled()
			expect(task["pendingModelNotices"]).toHaveLength(noticeCount)
		})

		it("does nothing for a command that is not allowed", async () => {
			await task.revokeAllowedCommand(ENTRY, { notifyModel: true })

			expect(task["pendingModelNotices"]).toEqual([])
			expect(task["saveClineMessages"]).not.toHaveBeenCalled()
		})

		it("prompts again for a revoked command", async () => {
			task.commandAllowlist.add(ENTRY)
			await task.revokeAllowedCommand(ENTRY, { notifyModel: false })

			const pending = askCommand(task, ENTRY)
			expect((await waitForPendingRow(task)).isAnswered).toBeUndefined()

			task.handleWebviewAskResponse("noButtonClicked")
			await pending
		})

		it("drops a pending revocation notice when the command is allowed again", async () => {
			task.commandAllowlist.add(ENTRY)
			await task.revokeAllowedCommand(ENTRY, { notifyModel: true })

			await task.allowCommandForTask({ ...ENTRY })

			expect(task["pendingModelNotices"]).toEqual([])
		})

		it("sends the revocation notice with the next user message, once", async () => {
			attachTurnHarness(task)
			task.commandAllowlist.add(ENTRY)
			await task.revokeAllowedCommand(ENTRY, { notifyModel: true })

			await task.recursivelyMakeClineRequests([{ type: "text", text: "next turn" }], false)

			const notice = formatResponse.commandAllowForTaskRevoked(ENTRY.command, ENTRY.cwd)
			const userMessages = task.apiConversationHistory.filter((message) => message.role === "user")
			expect(userMessages).toHaveLength(1)
			expect(userMessages[0].content).toEqual(
				expect.arrayContaining([
					{ type: "text", text: "next turn" },
					{ type: "text", text: notice },
				]),
			)
			expect(task["pendingModelNotices"]).toEqual([])
		})
	})
})
