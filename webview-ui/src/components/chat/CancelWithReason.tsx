import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, OctagonX } from "lucide-react"

import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Popover,
	PopoverContent,
	PopoverTrigger,
	StandardTooltip,
	Textarea,
} from "@src/components/ui"

// Survives row remounts (virtualized scrolling) so the notice stays visible after the abort button is gone.
const tooLateExecutionIds = new Set<string>()

const parseCancelResult = (event: MessageEvent): { executionId: string; cancelled: boolean } | undefined => {
	const message: ExtensionMessage = event.data
	if (message?.type !== "executionCancelResult" || !message.executionId) {
		return undefined
	}
	return { executionId: message.executionId, cancelled: message.success === true }
}

const recordCancelResult = (event: MessageEvent) => {
	const result = parseCancelResult(event)
	if (result && !result.cancelled) {
		tooLateExecutionIds.add(result.executionId)
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("message", recordCancelResult)
}

interface AbortButtonWithReasonProps {
	executionId: string
	onAbort: () => void
}

/** The abort button of a running command or MCP call, plus a dropdown to abort with a reason for the model. */
export const AbortButtonWithReason = ({ executionId, onAbort }: AbortButtonWithReasonProps) => {
	const { t } = useTranslation()
	const [menuOpen, setMenuOpen] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [reason, setReason] = useState("")

	const submit = useCallback(() => {
		const trimmed = reason.trim()
		if (!trimmed) {
			return
		}
		vscode.postMessage({ type: "cancelExecutionWithReason", executionId, text: trimmed })
		setDialogOpen(false)
		setReason("")
	}, [executionId, reason])

	return (
		<div className="flex flex-row items-center">
			<StandardTooltip content={t("chat:commandExecution.abort")}>
				<Button variant="ghost" size="icon" aria-label={t("chat:commandExecution.abort")} onClick={onAbort}>
					<OctagonX className="size-4" />
				</Button>
			</StandardTooltip>
			<Popover open={menuOpen} onOpenChange={setMenuOpen}>
				<StandardTooltip content={t("chat:cancelWithReason.menuTooltip")}>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="w-4"
							aria-label={t("chat:cancelWithReason.menuTooltip")}
							data-testid="cancel-with-reason-menu">
							<ChevronDown className="size-3" />
						</Button>
					</PopoverTrigger>
				</StandardTooltip>
				<PopoverContent align="end" className="w-auto p-1">
					<button
						className="w-full text-left text-sm px-2 py-1.5 rounded-xs cursor-pointer bg-transparent border-none text-vscode-dropdown-foreground hover:bg-vscode-list-hoverBackground"
						onClick={() => {
							setMenuOpen(false)
							setDialogOpen(true)
						}}>
						{t("chat:cancelWithReason.menuItem")}
					</button>
				</PopoverContent>
			</Popover>
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("chat:cancelWithReason.title")}</DialogTitle>
						<DialogDescription>{t("chat:cancelWithReason.description")}</DialogDescription>
					</DialogHeader>
					<Textarea
						autoFocus
						value={reason}
						placeholder={t("chat:cancelWithReason.placeholder")}
						data-testid="cancel-with-reason-input"
						onChange={(e) => setReason(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault()
								submit()
							}
						}}
					/>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setDialogOpen(false)}>
							{t("chat:cancelWithReason.keepRunning")}
						</Button>
						<Button disabled={!reason.trim()} onClick={submit} data-testid="cancel-with-reason-submit">
							{t("chat:cancelWithReason.submit")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

/** Points out a cancellation with reason that lost the race against the execution finishing. */
export const CancelTooLateNotice = ({ executionId }: { executionId: string }) => {
	const { t } = useTranslation()
	const [tooLate, setTooLate] = useState(() => tooLateExecutionIds.has(executionId))

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const result = parseCancelResult(event)
			if (result?.executionId === executionId && !result.cancelled) {
				setTooLate(true)
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [executionId])

	if (!tooLate) {
		return null
	}
	return (
		<div className="text-xs text-vscode-editorWarning-foreground mt-1" data-testid="cancel-too-late-notice">
			{t("chat:cancelWithReason.tooLate")}
		</div>
	)
}
