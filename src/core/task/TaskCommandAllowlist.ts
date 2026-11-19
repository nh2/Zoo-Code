import type { TaskAllowedCommand } from "@roo-code/types"

/**
 * Commands the user allowed to run without approval for the rest of one task.
 *
 * Matching is exact on both the command text and the resolved working
 * directory; there are deliberately no prefixes or patterns, so allowing
 * `deploy.sh staging` never also allows `deploy.sh production`.
 */
export class TaskCommandAllowlist {
	private entries: TaskAllowedCommand[]
	/** Whether the list was ever non-empty, i.e. whether persisting an empty list is meaningful. */
	private everHadEntries: boolean

	constructor(initial: readonly TaskAllowedCommand[] = []) {
		this.entries = []
		for (const entry of initial) {
			this.add(entry)
		}
		this.everHadEntries = this.entries.length > 0
	}

	has(entry: TaskAllowedCommand): boolean {
		return this.entries.some((e) => e.command === entry.command && e.cwd === entry.cwd)
	}

	/** Returns `false` if the entry was already present. */
	add(entry: TaskAllowedCommand): boolean {
		if (this.has(entry)) {
			return false
		}
		this.entries.push({ command: entry.command, cwd: entry.cwd })
		this.everHadEntries = true
		return true
	}

	/** Returns `false` if the entry was not present. */
	remove(entry: TaskAllowedCommand): boolean {
		const before = this.entries.length
		this.entries = this.entries.filter((e) => !(e.command === entry.command && e.cwd === entry.cwd))
		return this.entries.length !== before
	}

	list(): TaskAllowedCommand[] {
		return this.entries.map((e) => ({ ...e }))
	}

	/** The list to persist, or `undefined` when there is nothing to record. */
	toPersisted(): TaskAllowedCommand[] | undefined {
		return this.everHadEntries ? this.list() : undefined
	}
}
