// npx vitest run core/task-persistence/__tests__/taskMetadata.spec.ts

import * as os from "os"
import * as path from "path"

import { taskMetadata } from "../taskMetadata"

describe("taskMetadata taskAllowedCommands", () => {
	const base = {
		taskId: "task-1",
		taskNumber: 1,
		messages: [],
		globalStoragePath: path.join(os.tmpdir(), "zoo-task-metadata-spec"),
		workspace: "/srv/app",
	}

	it("omits the field for a task that never allowed a command", async () => {
		const { historyItem } = await taskMetadata(base)

		expect(historyItem).not.toHaveProperty("taskAllowedCommands")
	})

	it.each([
		["the allowed commands", [{ command: "./deploy.sh staging", cwd: "/srv/app" }]],
		["an empty list after a revocation", []],
	])("records %s", async (_label, taskAllowedCommands) => {
		const { historyItem } = await taskMetadata({ ...base, taskAllowedCommands })

		expect(historyItem.taskAllowedCommands).toEqual(taskAllowedCommands)
	})
})
