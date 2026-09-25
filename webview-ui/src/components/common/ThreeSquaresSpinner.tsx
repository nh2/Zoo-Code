import { cn } from "@/lib/utils"

// 3 squares of 4 + 2 gaps of 2 = 16, so every edge lands on a whole pixel at 16px.
const SQUARE_XS = [0, 6, 12]

interface ThreeSquaresSpinnerProps {
	className?: string
}

/** Low-FPS spinner, animated by `.three-squares-spinner` in index.css. */
export const ThreeSquaresSpinner = ({ className }: ThreeSquaresSpinnerProps) => (
	<svg
		className={cn("three-squares-spinner size-4 shrink-0", className)}
		viewBox="0 0 16 16"
		fill="currentColor"
		role="progressbar"
		aria-label="Loading">
		{SQUARE_XS.map((x) => (
			<rect key={x} x={x} y="6" width="4" height="4" />
		))}
	</svg>
)
