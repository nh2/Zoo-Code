// cd webview-ui && npx vitest run src/components/chat/__tests__/McpExecution.statusCache.spec.tsx

import { render, screen, act } from "@src/utils/test-utils"

import { McpExecution } from "../McpExecution"

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

const renderExecution = (executionId: string) =>
	render(<McpExecution executionId={executionId} serverName="srv" toolName="tool" text="{}" />)

describe("McpExecution status cache", () => {
	afterEach(() => {
		// Ends every execution the tests start so the module-level cache does not leak between tests.
		for (const executionId of ["1", "2", "3"]) {
			postStatus({ executionId, status: "error", error: "test cleanup" })
		}
	})

	it("keeps the running status across a remount while the call is still running", () => {
		const first = renderExecution("1")
		postStatus({ executionId: "1", status: "started", serverName: "srv", toolName: "tool" })
		first.unmount()

		renderExecution("1")

		expect(screen.getByText("execution.running")).toBeTruthy()
	})

	it("shows the running status when it was posted before the row mounted", () => {
		postStatus({ executionId: "2", status: "started", serverName: "srv", toolName: "tool" })

		renderExecution("2")

		expect(screen.getByText("execution.running")).toBeTruthy()
	})

	it("does not report a finished call as running after a remount", () => {
		const first = renderExecution("3")
		postStatus({ executionId: "3", status: "started", serverName: "srv", toolName: "tool" })
		postStatus({ executionId: "3", status: "completed", response: "done" })
		first.unmount()

		renderExecution("3")

		expect(screen.queryByText("execution.running")).toBeNull()
	})
})
