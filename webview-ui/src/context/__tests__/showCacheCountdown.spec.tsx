import { act, render } from "@testing-library/react"

import { ExtensionStateContextProvider, useExtensionState } from "../ExtensionStateContext"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

describe("showCacheCountdown extension state", () => {
	it.each([true, false])("exposes a posted showCacheCountdown=%s", async (value) => {
		let seen: boolean | undefined
		const Probe = () => {
			seen = useExtensionState().showCacheCountdown
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)
		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "state", state: { showCacheCountdown: value } } }),
			)
		})
		expect(seen).toBe(value)
	})
})
