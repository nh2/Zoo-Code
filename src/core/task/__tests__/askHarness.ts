import type { ExtensionState } from "@roo-code/types"

import { createRateLimitClock } from "../RateLimitClock"
import { Task } from "../Task"
import { TaskCommandAllowlist } from "../TaskCommandAllowlist"

// Lightweight `Task` doubles for driving `Task.ask` and one streaming turn
// without the extension host. Specs using `attachTurnHarness` must also mock
// `../../environment/getEnvironmentDetails`, which reaches into the VS Code window API.

/** The parts of the provider that `Task.ask` and the streaming-loop drive reach for. */
export type ProviderStub = {
	getState: () => Promise<Partial<ExtensionState>>
	postMessageToWebview: ReturnType<typeof vi.fn>
	postStateToWebviewWithoutTaskHistory: ReturnType<typeof vi.fn>
	getSkillsManager: () => undefined
	cwd: string
}

export function buildTask(provider: ProviderStub, taskCwd: string) {
	const task = Object.create(Task.prototype) as Task
	task["abort"] = false
	task["clineMessages"] = []
	task["askResponse"] = undefined
	task["askResponseText"] = undefined
	task["askResponseImages"] = undefined
	task["askResponseAllowCommandForTask"] = false
	task["pendingModelNotices"] = []
	Object.defineProperty(task, "commandAllowlist", { value: new TaskCommandAllowlist() })
	task["lastMessageTs"] = undefined
	task["addToClineMessages"] = vi.fn(async () => {})
	task["saveClineMessages"] = vi.fn(async () => true)
	task["updateClineMessage"] = vi.fn(async () => {})
	task["cancelAutoApprovalTimeout"] = vi.fn(() => {})
	task["checkpointSave"] = vi.fn(async () => {})
	task["emit"] = vi.fn()
	// A double assertion is unavoidable here: `providerRef` is a `WeakRef<ClineProvider>`,
	// and the stub is neither a `WeakRef` nor a whole `ClineProvider`. Constructing
	// either would drag in the extension host, when `Task.ask` only ever calls
	// `deref()`, `getState()` and `postMessageToWebview()` on it.
	task["providerRef"] = { deref: () => provider } as unknown as Task["providerRef"]
	Object.defineProperty(task, "workspacePath", { value: taskCwd })

	return task
}

export async function attachQueue(task: Task) {
	const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
	const queue = new MessageQueueService()
	Object.defineProperty(task, "messageQueueService", { value: queue })
	return queue
}

/**
 * Adds the fields `recursivelyMakeClineRequests` touches before its per-turn
 * reset, so a test can drive one assistant turn without the full provider
 * harness. The stubbed `attemptApiRequest` streams a single text chunk;
 * `abandoned` ends the loop right after the stream via the loop's
 * abort/abandoned exit, so the drive stops before any post-stream tool
 * presentation and never reaches the retry/backoff paths.
 */
export function attachTurnHarness(task: Task) {
	task.messageCounts = { user: 0, assistant: 0 }
	task.apiConversationHistory = []
	task["abandoned"] = true
	Object.defineProperty(task, "api", {
		value: { getModel: () => ({ id: "gpt-4.1", info: {} }) },
	})
	Object.defineProperty(task, "apiConfiguration", { value: { apiProvider: undefined } })
	Object.defineProperty(task, "rateLimitClock", { value: createRateLimitClock() })
	Object.defineProperty(task, "diffViewProvider", { value: { isEditing: false, reset: async () => {} } })
	Object.defineProperty(task, "streamingToolCallIndices", { value: new Map() })
	Object.defineProperty(task, "activeToolContexts", { value: new Map() })
	task["saveApiConversationHistory"] = vi.fn(async () => true)
	task["say"] = vi.fn(async () => undefined)
	// The loop rewrites the newest api_req_started row with cost data; the
	// no-op `say` stub above never adds one itself.
	task["clineMessages"].push({ type: "say", say: "api_req_started", text: "{}", ts: Date.now() })
	task["attemptApiRequest"] = vi.fn().mockImplementation(() =>
		(async function* () {
			yield { type: "text" as const, text: "next turn reply" }
		})(),
	)
}
