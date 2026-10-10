/**
 * Formats a file path for display in tooltips with consistent formatting.
 *
 * @param path - The file path to format
 * @param additionalContent - Optional additional content to append (e.g., line snippets, reasons)
 * @returns Formatted string ready for tooltip display
 *
 * @example
 * formatPathTooltip("/src/components/MyComponent.tsx")
 * // Returns: "/src/components/MyComponent.tsx" + U+200E
 *
 * @example
 * formatPathTooltip("src/utils/helper.ts", ":42-45")
 * // Returns: "src/utils/helper.ts" + U+200E + " :42-45"
 */
export function formatPathTooltip(path?: string, additionalContent?: string): string {
	if (!path) return ""

	const formattedPath = path + "\u200E"

	if (additionalContent) {
		return formattedPath + " " + additionalContent
	}

	return formattedPath
}
