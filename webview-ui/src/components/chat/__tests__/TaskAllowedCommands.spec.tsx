// npx vitest run src/components/chat/__tests__/TaskAllowedCommands.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import { TaskAllowedCommands } from "../TaskAllowedCommands"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
	initReactI18next: { type: "3rdParty", init: vi.fn() },
}))

const WORKSPACE = "/srv/app"
const DEPLOY = { command: "./deploy.sh staging", cwd: WORKSPACE }
const STATUS = { command: "systemctl status nginx", cwd: "/etc/nginx" }

function renderExpanded() {
	render(<TaskAllowedCommands taskId="task-1" commands={[DEPLOY, STATUS]} workspace={WORKSPACE} />)
	fireEvent.click(screen.getByRole("button", { name: /chat:task.allowedCommands.title/ }))
}

describe("TaskAllowedCommands", () => {
	beforeEach(() => vi.clearAllMocks())

	it("renders nothing without allowed commands", () => {
		const { container } = render(<TaskAllowedCommands taskId="task-1" commands={[]} workspace={WORKSPACE} />)

		expect(container).toBeEmptyDOMElement()
	})

	it("starts collapsed, showing the count", () => {
		render(<TaskAllowedCommands taskId="task-1" commands={[DEPLOY, STATUS]} workspace={WORKSPACE} />)

		expect(screen.getByText('chat:task.allowedCommands.title {"count":2}')).toBeInTheDocument()
		expect(screen.queryByText(DEPLOY.command)).not.toBeInTheDocument()
	})

	it("lists the commands when expanded, with the directory only outside the workspace", () => {
		renderExpanded()

		expect(screen.getByText(DEPLOY.command)).toBeInTheDocument()
		expect(screen.getByText(STATUS.command)).toBeInTheDocument()
		expect(screen.getByText('chat:task.allowedCommands.inDirectory {"cwd":"/etc/nginx"}')).toBeInTheDocument()
		expect(screen.queryByText(`chat:task.allowedCommands.inDirectory {"cwd":"${WORKSPACE}"}`)).toBeNull()
	})

	it("Revoke tells the model by default", () => {
		renderExpanded()

		fireEvent.click(screen.getAllByRole("button", { name: "chat:task.allowedCommands.revoke" })[1])

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "revokeTaskAllowedCommand",
			taskId: "task-1",
			taskAllowedCommand: STATUS,
			notifyModel: true,
		})
	})

	it("offers revoking without telling the model from the dropdown", () => {
		renderExpanded()

		fireEvent.click(screen.getAllByRole("button", { name: "chat:task.allowedCommands.moreRevokeOptions" })[0])
		fireEvent.click(screen.getByText("chat:task.allowedCommands.revokeSilently"))

		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "revokeTaskAllowedCommand",
			taskId: "task-1",
			taskAllowedCommand: DEPLOY,
			notifyModel: false,
		})
		expect(screen.queryByText("chat:task.allowedCommands.revokeSilently")).not.toBeInTheDocument()
	})
})
