// cd webview-ui && npx vitest run src/components/chat/__tests__/McpExecution.spec.tsx

import { render, screen, fireEvent, act } from "@src/utils/test-utils"

import { McpExecution } from "../McpExecution"
import { vscode } from "../../../utils/vscode"

vi.mock("../../../utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-i18next")>()),
	useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("../../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <div data-testid="code-block">{source}</div>,
}))

vi.mock("../../mcp/McpToolRow", () => ({
	default: () => <div data-testid="mcp-tool-row" />,
}))

const postStatus = (status: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "mcpExecutionStatus", text: JSON.stringify(status) } }),
		)
	})

describe("McpExecution abort button", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("is shown while running and posts abortMcpExecution for its executionId", () => {
		render(<McpExecution executionId="42" serverName="srv" toolName="tool" text="{}" />)

		expect(screen.queryByLabelText("chat:commandExecution.abort")).toBeNull()

		postStatus({ executionId: "42", status: "started", serverName: "srv", toolName: "tool" })
		fireEvent.click(screen.getByLabelText("chat:commandExecution.abort"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "abortMcpExecution", executionId: "42" })
	})

	it("ignores status for other executions", () => {
		render(<McpExecution executionId="42" serverName="srv" toolName="tool" text="{}" />)

		postStatus({ executionId: "99", status: "started", serverName: "srv", toolName: "tool" })

		expect(screen.queryByLabelText("chat:commandExecution.abort")).toBeNull()
	})

	it.each([
		{ status: "completed", response: "done" },
		{ status: "error", error: "Aborted by user" },
	])("is hidden once the execution reaches $status", (terminal) => {
		render(<McpExecution executionId="42" serverName="srv" toolName="tool" text="{}" />)

		postStatus({ executionId: "42", status: "started", serverName: "srv", toolName: "tool" })
		expect(screen.getByLabelText("chat:commandExecution.abort")).toBeTruthy()

		postStatus({ executionId: "42", ...terminal })
		expect(screen.queryByLabelText("chat:commandExecution.abort")).toBeNull()
	})
})
