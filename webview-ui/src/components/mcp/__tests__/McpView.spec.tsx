import type { McpServer } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import McpView from "../McpView"

const setMcpEnabled = vi.fn()

const extensionState = vi.hoisted(() => ({
	mcpServers: [] as McpServer[],
	alwaysAllowMcp: false,
	mcpEnabled: false,
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/hooks/useTooManyTools", () => ({
	useTooManyTools: () => ({ isOverThreshold: false, title: "", message: "" }),
}))

vi.mock("@src/components/settings/Section", () => ({
	Section: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@src/components/settings/SectionHeader", () => ({
	SectionHeader: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ToggleSwitch: () => null,
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../McpEnabledToggle", () => ({
	default: ({
		mcpEnabled,
		setMcpEnabled: setEnabled,
	}: {
		mcpEnabled: boolean
		setMcpEnabled?: (value: boolean) => void
	}) => (
		<button data-testid="mcp-enabled-toggle" onClick={() => setEnabled?.(!mcpEnabled)}>
			{String(mcpEnabled)}
		</button>
	),
}))

describe("McpView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		extensionState.mcpServers = []
		extensionState.mcpEnabled = false
	})

	it("uses extension state when no buffered value is provided", () => {
		render(<McpView />)

		expect(screen.getByTestId("mcp-enabled-toggle")).toHaveTextContent("false")
	})

	it("uses and updates the buffered value when controlled", () => {
		render(<McpView mcpEnabled={true} setMcpEnabled={setMcpEnabled} />)

		fireEvent.click(screen.getByTestId("mcp-enabled-toggle"))

		expect(setMcpEnabled).toHaveBeenCalledWith(false)
	})

	describe("disconnected server", () => {
		const crashedServer: McpServer = {
			name: "crashy-server",
			config: "{}",
			status: "disconnected",
			source: "global",
			error: "MCP error -32000: Connection closed",
			stderrTail: "Traceback (most recent call last):\nOSError: [Errno 5] Input/output error: '/x'",
			errorHistory: [{ message: "OSError: [Errno 5] Input/output error: '/x'", timestamp: 1, level: "error" }],
		}

		const renderWithServer = (server: McpServer) => {
			extensionState.mcpEnabled = true
			extensionState.mcpServers = [server]
			render(<McpView />)
		}

		it("shows the error, the stderr tail and a Show Logs button that opens the Output channel", () => {
			renderWithServer(crashedServer)

			expect(screen.getByText("MCP error -32000: Connection closed")).toBeInTheDocument()
			expect(screen.getByTestId("mcp-stderr-tail")).toHaveTextContent("OSError: [Errno 5] Input/output error")

			fireEvent.click(screen.getByText("mcp:serverStatus.showLogs"))

			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showMcpOutputChannel" })
		})

		it("can be expanded to a Logs tab with the error history", () => {
			renderWithServer(crashedServer)

			expect(screen.queryByText(/mcp:tabs\.logs/)).not.toBeInTheDocument()

			fireEvent.click(screen.getByText("crashy-server"))

			expect(screen.getByText(/mcp:tabs\.logs/)).toHaveTextContent("(1)")
			expect(screen.queryByText(/mcp:tabs\.tools/)).not.toBeInTheDocument()
		})

		it("is not expandable while disabled", () => {
			renderWithServer({ ...crashedServer, disabled: true })

			fireEvent.click(screen.getByText("crashy-server"))

			expect(screen.queryByText(/mcp:tabs\.logs/)).not.toBeInTheDocument()
			expect(screen.queryByText("mcp:serverStatus.showLogs")).not.toBeInTheDocument()
		})
	})
})
