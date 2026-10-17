import React from "react"

import type { ClineMessage } from "@roo-code/types"

import { renderWithExtensionState, screen } from "@/utils/test-utils"

import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("../Markdown", () => ({
	Markdown: ({ markdown }: { markdown?: string }) => <div data-testid="markdown">{markdown}</div>,
}))

const renderText = (message: ClineMessage) =>
	renderWithExtensionState(
		<ChatRowContent
			message={message}
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

describe("ChatRow - assistant text", () => {
	it("labels a progress update as such, with an explanation, in the muted colour", () => {
		renderText({ type: "say", say: "text", ts: 1, text: "Checking the log.", progressUpdate: true })

		const label = screen.getByText("chat:text.rooProgressUpdate")
		expect(label).toHaveAttribute("title", "chat:text.progressUpdateTooltip")
		expect(screen.queryByText("chat:text.rooSaid")).toBeNull()
		expect(screen.getByTestId("markdown").parentElement).toHaveClass("text-vscode-descriptionForeground")
	})

	it("shows ordinary text as Zoo said", () => {
		renderText({ type: "say", say: "text", ts: 1, text: "Plain answer." })

		expect(screen.getByText("chat:text.rooSaid")).toBeInTheDocument()
		expect(screen.queryByText("chat:text.rooProgressUpdate")).toBeNull()
		expect(screen.getByTestId("markdown").parentElement).not.toHaveClass("text-vscode-descriptionForeground")
	})
})
