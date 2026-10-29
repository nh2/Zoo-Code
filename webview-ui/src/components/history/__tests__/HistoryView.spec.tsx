import { render, screen, fireEvent, act } from "@/utils/test-utils"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import HistoryView from "../HistoryView"

vi.mock("@src/context/ExtensionStateContext")
vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockTaskHistory = [
	{
		id: "1",
		task: "Test task 1",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
		workspace: "/test/workspace",
	},
	{
		id: "2",
		task: "Test task 2",
		ts: Date.now() + 1000,
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.003,
		workspace: "/test/workspace",
	},
]

describe("HistoryView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/test/workspace",
		})
	})

	it("renders the history interface", () => {
		const onDone = vi.fn()
		render(<HistoryView onDone={onDone} />)

		// Check for main UI elements
		expect(screen.getByText("history:history")).toBeInTheDocument()
		expect(screen.getByText("history:done")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("history:searchPlaceholder")).toBeInTheDocument()
	})

	it("searches full conversations only when the button is clicked", () => {
		render(<HistoryView onDone={vi.fn()} />)

		const button = screen.getByTestId("search-conversations-button")
		expect(button).toBeDisabled()

		fireEvent.input(screen.getByTestId("history-search-input"), { target: { value: "issues/1985" } })
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "searchTaskConversations" }),
		)

		expect(button).toBeEnabled()
		fireEvent.click(button)

		const request = vi.mocked(vscode.postMessage).mock.lastCall![0]
		expect(request).toMatchObject({ type: "searchTaskConversations", query: "issues/1985", ids: ["1", "2"] })
		expect(screen.getByTestId("conversation-search-status")).toHaveTextContent("history:searchingConversations")

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "taskConversationSearchResults",
						requestId: request.requestId,
						taskConversationMatches: [
							{
								taskId: "1",
								matchCount: 2,
								snippet: "see issues/1985",
								snippetMatchStart: 4,
								snippetMatchLength: 11,
							},
						],
					},
				}),
			)
		})

		// Virtuoso renders no rows in jsdom; row content is covered by TaskItem and useTaskSearch tests.
		expect(screen.getByTestId("conversation-search-status")).toHaveTextContent("history:conversationSearchResults")
	})

	it("calls onDone when done button is clicked", () => {
		const onDone = vi.fn()
		render(<HistoryView onDone={onDone} />)

		const doneButton = screen.getByText("history:done")
		fireEvent.click(doneButton)

		expect(onDone).toHaveBeenCalled()
	})
})
