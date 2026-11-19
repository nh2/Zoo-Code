// cd webview-ui && npx vitest run src/components/chat/__tests__/CancelWithReason.spec.tsx

import { render, screen, fireEvent, act } from "@src/utils/test-utils"

import { AbortButtonWithReason, CancelTooLateNotice } from "../CancelWithReason"
import { vscode } from "../../../utils/vscode"

vi.mock("../../../utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-i18next")>()),
	useTranslation: () => ({ t: (key: string) => key }),
}))

const postCancelResult = (executionId: string, success: boolean) =>
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "executionCancelResult", executionId, success, text: "reason" },
			}),
		)
	})

const openDialog = () => {
	fireEvent.click(screen.getByTestId("cancel-with-reason-menu"))
	fireEvent.click(screen.getByText("chat:cancelWithReason.menuItem"))
}

describe("AbortButtonWithReason", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("aborts without a reason through the plain button", () => {
		const onAbort = vi.fn()
		render(<AbortButtonWithReason executionId="1" onAbort={onAbort} />)

		fireEvent.click(screen.getByLabelText("chat:commandExecution.abort"))

		expect(onAbort).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it.each([
		["the submit button", () => fireEvent.click(screen.getByTestId("cancel-with-reason-submit"))],
		["Enter", () => fireEvent.keyDown(screen.getByTestId("cancel-with-reason-input"), { key: "Enter" })],
	])("sends the trimmed reason for its execution via %s", (_how, submit) => {
		const onAbort = vi.fn()
		render(<AbortButtonWithReason executionId="7" onAbort={onAbort} />)
		openDialog()

		fireEvent.change(screen.getByTestId("cancel-with-reason-input"), { target: { value: "  use pnpm  " } })
		submit()

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "cancelExecutionWithReason",
			executionId: "7",
			text: "use pnpm",
		})
		expect(onAbort).not.toHaveBeenCalled()
		expect(screen.queryByTestId("cancel-with-reason-input")).toBeNull()
	})

	it("does not send an empty reason", () => {
		render(<AbortButtonWithReason executionId="8" onAbort={vi.fn()} />)
		openDialog()

		fireEvent.change(screen.getByTestId("cancel-with-reason-input"), { target: { value: "   " } })
		fireEvent.keyDown(screen.getByTestId("cancel-with-reason-input"), { key: "Enter" })

		expect(screen.getByTestId("cancel-with-reason-submit")).toBeDisabled()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})
})

describe("CancelTooLateNotice", () => {
	it("shows only after a failed cancellation of its own execution, and survives a remount", () => {
		const first = render(<CancelTooLateNotice executionId="20" />)

		postCancelResult("20", true)
		postCancelResult("21", false)
		expect(screen.queryByTestId("cancel-too-late-notice")).toBeNull()

		postCancelResult("20", false)
		expect(screen.getByTestId("cancel-too-late-notice")).toHaveTextContent("chat:cancelWithReason.tooLate")

		first.unmount()
		render(<CancelTooLateNotice executionId="20" />)
		expect(screen.getByTestId("cancel-too-late-notice")).toBeInTheDocument()
	})
})
