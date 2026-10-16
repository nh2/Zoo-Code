import React from "react"

import { fireEvent, renderWithExtensionState, screen } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
}))

vi.mock("../ChatTextArea", () => ({
	ChatTextArea: ({
		inputValue,
		setInputValue,
		onSend,
		onCancel,
	}: {
		inputValue: string
		setInputValue: (value: string) => void
		onSend: () => void
		onCancel: () => void
	}) => (
		<div>
			<textarea data-testid="edit-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
			<button onClick={onSend}>send</button>
			<button onClick={onCancel}>cancel</button>
		</div>
	),
}))

const renderUserFeedback = () =>
	renderWithExtensionState(
		<ChatRowContent
			message={{ type: "say", say: "user_feedback", ts: 42, text: "original" }}
			isExpanded={false}
			isLast={false}
			isStreaming={false}
			onToggleExpand={vi.fn()}
			onSuggestionClick={vi.fn()}
			onBatchFileResponse={vi.fn()}
			onFollowUpUnmount={vi.fn()}
			isFollowUpAnswered={false}
		/>,
	)

describe("ChatRow - editing a user message", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("keeps the edited text in the editor after submitting, so cancelling the confirmation returns to it", () => {
		renderUserFeedback()

		fireEvent.click(screen.getByTitle("chat:queuedMessages.clickToEdit"))
		fireEvent.change(screen.getByTestId("edit-input"), { target: { value: "edited" } })
		fireEvent.click(screen.getByText("send"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "submitEditedMessage",
			value: 42,
			editedMessageContent: "edited",
			images: [],
		})
		expect(screen.getByTestId("edit-input")).toHaveValue("edited")
	})

	it("leaves the editor when the edit itself is cancelled", () => {
		renderUserFeedback()

		fireEvent.click(screen.getByTitle("chat:queuedMessages.clickToEdit"))
		fireEvent.click(screen.getByText("cancel"))

		expect(screen.queryByTestId("edit-input")).not.toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "submitEditedMessage" }))
	})
})
