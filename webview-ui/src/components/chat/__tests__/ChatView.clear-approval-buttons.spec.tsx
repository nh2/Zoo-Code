// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.clear-approval-buttons.spec.tsx

import React from "react"
import { renderWithExtensionState, waitFor, act, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps, ChatViewRef } from "../ChatView"

interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
	isAnswered?: boolean
	isProtected?: boolean
	requestsTaskAllow?: boolean
	checkpoint?: Record<string, unknown>
}

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const mockPlayFunction = vi.fn()
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [mockPlayFunction]),
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({
		message,
		completionCheckpoint,
	}: {
		message: ClineMessage
		completionCheckpoint?: { ts: number; commitHash: string }
	}) {
		return (
			<div data-testid="chat-row">
				{JSON.stringify(message)}
				{((message.type === "say" && message.say === "completion_result") ||
					(message.type === "ask" && message.ask === "completion_result" && message.text)) &&
				completionCheckpoint ? (
					<div data-testid="completion-checkpoint-actions">
						<button type="button">chat:seeNewChanges.title</button>
						<button type="button">chat:restoreChanges.title</button>
					</div>
				) : null}
			</div>
		)
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	},
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	default: () => <div data-testid="roo-tips">Tips content</div>,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => <div data-testid="roo-hero">Hero content</div>,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

// The i18n mock returns the key itself, so button labels render as their keys.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
}))

const RUN_BUTTON_LABEL = "chat:runCommand.title"
const RUN_ALLOW_FOR_TASK_BUTTON_LABEL = "chat:runCommandAllowForTask.title"
const APPROVE_BUTTON_LABEL = "chat:approve.title"
const DENY_BUTTON_LABEL = "chat:reject.title"
const START_NEW_TASK_BUTTON_LABEL = "chat:startNewTask.title"
const SEE_NEW_CHANGES_BUTTON_LABEL = "chat:seeNewChanges.title"
const RESTORE_CHANGES_BUTTON_LABEL = "chat:restoreChanges.title"

const hydrateState = (clineMessages: ClineMessage[]) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages,
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const renderChatView = (props: Partial<ChatViewProps> = {}) =>
	renderWithExtensionState(<ChatView {...defaultProps} {...props} />)

const commandAsk = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{ type: "ask", ask: "command", ts: 2, text: "echo hi", partial: false },
]

const autoApprovedCommandAsk = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{ type: "ask", ask: "command", ts: 2, text: "echo hi", partial: false, isAnswered: true },
]

const completionAskWithoutCheckpoint = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{ type: "ask", ask: "completion_result", ts: 2, text: "Task complete", partial: false },
]

const completionAskWithCheckpoint = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{
		type: "say",
		say: "checkpoint_saved",
		ts: 2,
		text: "checkpoint-after-user-prompt",
		checkpoint: { suppressMessage: true },
	},
	{ type: "say", say: "completion_result", ts: 3, text: "Task complete" },
	{ type: "ask", ask: "completion_result", ts: 4, text: "", partial: false },
]

const askOnlyCompletionWithCheckpoint = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{
		type: "say",
		say: "checkpoint_saved",
		ts: 2,
		text: "checkpoint-after-user-prompt",
		checkpoint: { suppressMessage: true },
	},
	{ type: "ask", ask: "completion_result", ts: 3, text: "Task complete", partial: false },
]

const mcpAsk = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{
		type: "ask",
		ask: "use_mcp_server",
		ts: 2,
		text: JSON.stringify({ type: "use_mcp_tool", serverName: "srv", toolName: "run_command" }),
		partial: false,
	},
]

describe("ChatView approval button behavior", () => {
	it("clears MCP Approve/Deny once the request starts after a queued approval", async () => {
		const { queryByText } = renderChatView()

		await act(async () => {
			hydrateState(mcpAsk())
		})
		await waitFor(() => {
			expect(queryByText(APPROVE_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(DENY_BUTTON_LABEL)).toBeInTheDocument()
		})

		await act(async () => {
			hydrateState([
				...mcpAsk(),
				{ type: "say", say: "user_feedback", ts: 3, text: "queued message" },
				{ type: "say", say: "mcp_server_request_started", ts: 4 },
			])
		})
		await waitFor(() => {
			expect(queryByText(APPROVE_BUTTON_LABEL)).not.toBeInTheDocument()
			expect(queryByText(DENY_BUTTON_LABEL)).not.toBeInTheDocument()
		})
	})

	beforeEach(() => vi.clearAllMocks())

	it("shows Run/Deny buttons for a command ask that requires manual approval", async () => {
		const { queryByText } = renderChatView()

		await act(async () => {
			hydrateState(commandAsk())
		})

		await waitFor(() => {
			expect(queryByText(RUN_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(DENY_BUTTON_LABEL)).toBeInTheDocument()
		})
	})

	it("never shows Run/Deny buttons when the command ask is already answered (auto-approved)", async () => {
		const { queryByText } = renderChatView()

		await act(async () => {
			hydrateState(autoApprovedCommandAsk())
		})

		// isAnswered:true on the message means the ask was resolved before the
		// webview rendered it -- buttons must never appear.
		await waitFor(() => {
			expect(queryByText(RUN_BUTTON_LABEL)).not.toBeInTheDocument()
			expect(queryByText(DENY_BUTTON_LABEL)).not.toBeInTheDocument()
		})

		// No askResponse should have been sent, since the backend already responded.
		const askResponseCalls = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
			([msg]) => msg?.type === "askResponse",
		)
		expect(askResponseCalls).toHaveLength(0)
	})

	it("shows Kilo-style completion checkpoint actions inline when a latest-prompt checkpoint is available", async () => {
		const { queryByText, queryByTestId } = renderChatView()

		await act(async () => {
			hydrateState(completionAskWithCheckpoint())
		})

		await waitFor(() => {
			expect(queryByTestId("completion-checkpoint-actions")).toBeInTheDocument()
			expect(queryByText(SEE_NEW_CHANGES_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(RESTORE_CHANGES_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(START_NEW_TASK_BUTTON_LABEL)).toBeInTheDocument()
		})
	})

	it("shows inline checkpoint actions for ask-only completion rows with text", async () => {
		const { queryByText, queryByTestId } = renderChatView()

		await act(async () => {
			hydrateState(askOnlyCompletionWithCheckpoint())
		})

		await waitFor(() => {
			expect(queryByTestId("completion-checkpoint-actions")).toBeInTheDocument()
			expect(queryByText(SEE_NEW_CHANGES_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(RESTORE_CHANGES_BUTTON_LABEL)).toBeInTheDocument()
		})
	})

	it("keeps Start New Task for completion results without a latest-prompt checkpoint", async () => {
		const { queryByText } = renderChatView()

		await act(async () => {
			hydrateState(completionAskWithoutCheckpoint())
		})

		await waitFor(() => {
			expect(queryByText(START_NEW_TASK_BUTTON_LABEL)).toBeInTheDocument()
			expect(queryByText(SEE_NEW_CHANGES_BUTTON_LABEL)).not.toBeInTheDocument()
			expect(queryByText(RESTORE_CHANGES_BUTTON_LABEL)).not.toBeInTheDocument()
		})
	})

	it("keeps Start New Task as the bottom completion action even when inline checkpoint actions are available", async () => {
		const { getByText } = renderChatView()

		await act(async () => {
			hydrateState(completionAskWithCheckpoint())
		})

		await waitFor(() => {
			expect(getByText(START_NEW_TASK_BUTTON_LABEL)).toBeInTheDocument()
		})

		fireEvent.click(getByText(START_NEW_TASK_BUTTON_LABEL))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "clearTask" })
	})
})

describe("ChatView Run + allow for task", () => {
	beforeEach(() => vi.clearAllMocks())

	const commandAskWith = (fields: Partial<ClineMessage>): ClineMessage[] => [
		{ type: "say", say: "task", ts: 1, text: "Initial task" },
		{ type: "ask", ask: "command", ts: 2, text: "./deploy.sh staging", partial: false, ...fields },
	]

	const buttonByLabel = (queryByText: (text: string) => HTMLElement | null, label: string) =>
		queryByText(label)?.closest("button") ?? null

	async function renderCommandAsk(fields: Partial<ClineMessage> = {}) {
		const ref = React.createRef<ChatViewRef>()
		const view = renderWithExtensionState(<ChatView {...defaultProps} ref={ref} />)
		await act(async () => {
			hydrateState(commandAskWith(fields))
		})
		await waitFor(() => expect(view.queryByText(RUN_BUTTON_LABEL)).toBeInTheDocument())
		return { ...view, ref }
	}

	it("offers the button between Run and Deny", async () => {
		const { getAllByRole } = await renderCommandAsk()

		const labels = getAllByRole("button").map((button) => button.textContent)
		const runIndex = labels.indexOf(RUN_BUTTON_LABEL)
		expect(labels.slice(runIndex, runIndex + 3)).toEqual([
			RUN_BUTTON_LABEL,
			RUN_ALLOW_FOR_TASK_BUTTON_LABEL,
			DENY_BUTTON_LABEL,
		])
	})

	it("is not offered for a protected command", async () => {
		const { queryByText } = await renderCommandAsk({ isProtected: true })

		expect(queryByText(RUN_ALLOW_FOR_TASK_BUTTON_LABEL)).not.toBeInTheDocument()
	})

	it("sends an approval that allows the command for the task", async () => {
		const { getByText, queryByText } = await renderCommandAsk()

		fireEvent.click(getByText(RUN_ALLOW_FOR_TASK_BUTTON_LABEL))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
			allowCommandForTask: true,
		})
		await waitFor(() => expect(queryByText(RUN_ALLOW_FOR_TASK_BUTTON_LABEL)).not.toBeInTheDocument())
	})

	it("sends a plain approval from Run", async () => {
		const { getByText } = await renderCommandAsk()

		fireEvent.click(getByText(RUN_BUTTON_LABEL))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "askResponse", askResponse: "yesButtonClicked" })
	})

	it.each([
		["the model asked to repeat the command", true, RUN_ALLOW_FOR_TASK_BUTTON_LABEL, RUN_BUTTON_LABEL],
		["the model did not ask to repeat it", undefined, RUN_BUTTON_LABEL, RUN_ALLOW_FOR_TASK_BUTTON_LABEL],
	])("highlights the default action when %s", async (_label, requestsTaskAllow, primary, secondary) => {
		const { queryByText } = await renderCommandAsk({ requestsTaskAllow })

		expect(buttonByLabel(queryByText, primary)).toHaveClass("bg-primary")
		expect(buttonByLabel(queryByText, secondary)).toHaveClass("bg-secondary")
	})

	it.each([
		["Run + allow for task when the model asked to repeat", true, { allowCommandForTask: true }],
		["Run otherwise", undefined, {}],
	])("Enter triggers %s", async (_label, requestsTaskAllow, extra) => {
		const { ref } = await renderCommandAsk({ requestsTaskAllow })

		act(() => ref.current?.acceptInput())

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
			...extra,
		})
	})
})
