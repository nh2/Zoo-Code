// npx vitest run src/components/common/__tests__/LowFpsSpinner.spec.tsx

import { render, screen } from "@/utils/test-utils"

import { LowFpsSpinner } from "../LowFpsSpinner"
import CodeAccordion from "../CodeAccordion"

vi.mock("../CodeBlock", () => ({ default: () => null }))
vi.mock("../DiffView", () => ({ default: () => null }))

describe("LowFpsSpinner", () => {
	it("renders three whole-pixel squares with the stepped animation class", () => {
		render(<LowFpsSpinner />)

		const spinner = screen.getByRole("progressbar", { name: "Loading" })
		expect(spinner).toHaveClass("three-squares-spinner")
		expect(spinner).toHaveAttribute("viewBox", "0 0 16 16")

		const squares = spinner.querySelectorAll("rect")
		expect([...squares].map((s) => s.getAttribute("x"))).toEqual(["0", "6", "12"])
		for (const square of squares) {
			expect(square).toHaveAttribute("width", "4")
			expect(square).toHaveAttribute("height", "4")
		}
	})

	it("keeps caller classes", () => {
		render(<LowFpsSpinner className="size-3 mr-2" />)

		expect(screen.getByRole("progressbar")).toHaveClass("three-squares-spinner", "size-3", "mr-2")
	})
})

describe("CodeAccordion", () => {
	const props = { path: "src/a.ts", code: "", language: "ts", isExpanded: false, onToggleExpand: () => {} }

	it("shows the low-FPS spinner while loading", () => {
		render(<CodeAccordion {...props} isLoading />)

		expect(screen.getByRole("progressbar")).toHaveClass("three-squares-spinner")
	})

	it("shows no spinner once loading is done", () => {
		render(<CodeAccordion {...props} isLoading={false} />)

		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})
})
