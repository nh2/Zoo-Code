import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Fzf } from "fzf"

import type { ExtensionMessage, TaskConversationMatch } from "@roo-code/types"

import { highlightFzfMatch } from "@/utils/highlight"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"

import type { DisplayHistoryItem } from "./types"

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

export type ConversationSearchStatus = "idle" | "loading" | "done"

type ConversationSearchState = {
	requestId: string
	status: Exclude<ConversationSearchStatus, "idle">
	matches: TaskConversationMatch[]
}

function rangePositions(start: number, length: number): number[] {
	return Array.from({ length }, (_, i) => start + i)
}

export const useTaskSearch = () => {
	const { taskHistory, cwd } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)
	const [conversationSearch, setConversationSearch] = useState<ConversationSearchState | null>(null)
	const requestCounter = useRef(0)

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	// Full-conversation results belong to the query and scope they were requested for.
	useEffect(() => {
		setConversationSearch(null)
	}, [searchQuery, showAllWorkspaces])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message?.type !== "taskConversationSearchResults") {
				return
			}
			setConversationSearch((current) =>
				current && current.requestId === message.requestId
					? { ...current, status: "done", matches: message.taskConversationMatches ?? [] }
					: current,
			)
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const presentableTasks = useMemo(() => {
		let tasks = taskHistory.filter((item) => item.ts && item.task)
		if (!showAllWorkspaces) {
			tasks = tasks.filter((item) => item.workspace === cwd)
		}
		return tasks
	}, [taskHistory, showAllWorkspaces, cwd])

	const searchConversations = useCallback(() => {
		const query = searchQuery.trim()
		if (!query) {
			return
		}
		const requestId = `task-conversation-search-${++requestCounter.current}`
		setConversationSearch({ requestId, status: "loading", matches: [] })
		vscode.postMessage({
			type: "searchTaskConversations",
			query,
			ids: presentableTasks.map((item) => item.id),
			requestId,
		})
	}, [searchQuery, presentableTasks])

	const fzf = useMemo(() => {
		return new Fzf(presentableTasks, {
			selector: (item) => item.task,
		})
	}, [presentableTasks])

	const conversationResults = conversationSearch?.status === "done" ? conversationSearch.matches : null

	const tasks = useMemo(() => {
		let results: DisplayHistoryItem[] = presentableTasks

		if (conversationResults) {
			const tasksById = new Map(presentableTasks.map((item) => [item.id, item]))
			results = conversationResults.flatMap((match) => {
				const item = tasksById.get(match.taskId)
				return item
					? [
							{
								...item,
								conversationMatchCount: match.matchCount,
								conversationSnippet: highlightFzfMatch(
									match.snippet,
									rangePositions(match.snippetMatchStart, match.snippetMatchLength),
								),
							},
						]
					: []
			})
		} else if (searchQuery) {
			const searchResults = fzf.find(searchQuery)
			results = searchResults.map((result) => {
				const positions = Array.from(result.positions)
				const taskEndIndex = result.item.task.length

				return {
					...result.item,
					highlight: highlightFzfMatch(
						result.item.task,
						positions.filter((p) => p < taskEndIndex),
					),
					workspace: result.item.workspace,
				}
			})
		}

		// Then sort the results
		return [...results].sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return (a.ts || 0) - (b.ts || 0)
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
					const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
					return bTokens - aTokens
				case "mostRelevant":
					if (conversationResults) {
						return (
							(b.conversationMatchCount || 0) - (a.conversationMatchCount || 0) ||
							(b.ts || 0) - (a.ts || 0)
						)
					}
					// Keep fzf order if searching, otherwise sort by newest
					return searchQuery ? 0 : (b.ts || 0) - (a.ts || 0)
				case "newest":
				default:
					return (b.ts || 0) - (a.ts || 0)
			}
		})
	}, [presentableTasks, searchQuery, fzf, sortOption, conversationResults])

	return {
		tasks,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		lastNonRelevantSort,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
		searchConversations,
		conversationSearchStatus: (conversationSearch?.status ?? "idle") as ConversationSearchStatus,
	}
}
