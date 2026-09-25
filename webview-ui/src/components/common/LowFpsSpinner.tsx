import { ThreeSquaresSpinner } from "./ThreeSquaresSpinner"

interface LowFpsSpinnerProps {
	className?: string
}

/** The app's loading spinner; import this rather than a specific style, so the style can change in one place. */
export const LowFpsSpinner = ({ className }: LowFpsSpinnerProps) => <ThreeSquaresSpinner className={className} />
