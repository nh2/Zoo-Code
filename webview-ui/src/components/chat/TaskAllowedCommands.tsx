import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight } from "lucide-react"

import type { TaskAllowedCommand } from "@roo-code/types"

import { Button, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { vscode } from "@src/utils/vscode"

interface TaskAllowedCommandsProps {
	taskId: string
	commands: TaskAllowedCommand[]
	/** The task's workspace; a command's working directory is only shown when it differs. */
	workspace?: string
}

function revoke(taskId: string, entry: TaskAllowedCommand, notifyModel: boolean) {
	vscode.postMessage({ type: "revokeTaskAllowedCommand", taskId, taskAllowedCommand: entry, notifyModel })
}

const RevokeButton = ({ taskId, entry }: { taskId: string; entry: TaskAllowedCommand }) => {
	const { t } = useTranslation()
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	return (
		<div className="flex shrink-0">
			<StandardTooltip content={t("chat:task.allowedCommands.revokeTooltip")}>
				<Button
					variant="secondary"
					size="sm"
					className="rounded-r-none h-6 px-2"
					onClick={() => revoke(taskId, entry, true)}>
					{t("chat:task.allowedCommands.revoke")}
				</Button>
			</StandardTooltip>
			<Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="secondary"
						size="sm"
						className="rounded-l-none border-l border-vscode-input-background h-6 px-1"
						aria-label={t("chat:task.allowedCommands.moreRevokeOptions")}>
						<ChevronDown className="size-3" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" container={portalContainer} className="w-auto p-1">
					<button
						className="w-full text-left text-sm px-2 py-1 bg-transparent border-none rounded-xs cursor-pointer text-vscode-foreground hover:bg-vscode-list-hoverBackground"
						onClick={() => {
							setIsMenuOpen(false)
							revoke(taskId, entry, false)
						}}>
						{t("chat:task.allowedCommands.revokeSilently")}
					</button>
				</PopoverContent>
			</Popover>
		</div>
	)
}

export const TaskAllowedCommands = ({ taskId, commands, workspace }: TaskAllowedCommandsProps) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)

	if (commands.length === 0) {
		return null
	}

	return (
		<div data-testid="task-allowed-commands" onClick={(e) => e.stopPropagation()}>
			<button
				className="flex items-center gap-1 p-0 bg-transparent border-none cursor-pointer text-sm font-medium text-vscode-foreground"
				aria-expanded={isExpanded}
				onClick={() => setIsExpanded(!isExpanded)}>
				{isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
				{t("chat:task.allowedCommands.title", { count: commands.length })}
			</button>
			{isExpanded && (
				<div className="mt-1 flex flex-col gap-1.5">
					<p className="m-0 text-xs text-vscode-descriptionForeground">
						{t("chat:task.allowedCommands.description")}
					</p>
					{commands.map((entry) => (
						<div key={`${entry.cwd}\0${entry.command}`} className="flex items-start gap-2">
							<div className="grow min-w-0">
								<code className="block whitespace-pre-wrap break-all text-xs">{entry.command}</code>
								{entry.cwd !== workspace && (
									<div className="text-xs text-vscode-descriptionForeground break-all">
										{t("chat:task.allowedCommands.inDirectory", { cwd: entry.cwd })}
									</div>
								)}
							</div>
							<RevokeButton taskId={taskId} entry={entry} />
						</div>
					))}
				</div>
			)}
		</div>
	)
}
