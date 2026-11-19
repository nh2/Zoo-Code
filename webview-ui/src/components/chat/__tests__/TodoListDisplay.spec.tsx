import { fireEvent, render } from "@testing-library/react"

import { TodoListDisplay } from "../TodoListDisplay"

type Todo = { id: string; content: string; status: "completed" | "in_progress" | "pending" }

const buildTodos = (inProgressIndex: number): Todo[] =>
	Array.from({ length: 10 }, (_, i) => ({
		id: `todo-${i}`,
		content: `Todo ${i}`,
		status: i < inProgressIndex ? "completed" : i === inProgressIndex ? "in_progress" : "pending",
	}))

const renderExpanded = (todos: Todo[]) => {
	const view = render(<TodoListDisplay todos={todos} />)
	fireEvent.click(view.getByText(`Todo ${todos.findIndex((todo) => todo.status === "in_progress")}`))
	const list = view.container.querySelector("ul")
	if (!(list instanceof HTMLUListElement)) {
		throw new Error("Expected the expanded todo list")
	}
	return { ...view, list }
}

// jsdom has no layout, so re-centring on the current todo always computes `scrollTop` 0.
const USER_SCROLL_TOP = 150

describe("TodoListDisplay scrolling", () => {
	it("keeps the user's scroll position when an equal todo list arrives as a new array", () => {
		const { list, rerender } = renderExpanded(buildTodos(2))
		list.scrollTop = USER_SCROLL_TOP

		rerender(<TodoListDisplay todos={buildTodos(2)} />)

		expect(list.scrollTop).toBe(USER_SCROLL_TOP)
	})

	it("re-centres on the current todo when progress moves to another item", () => {
		const { list, rerender } = renderExpanded(buildTodos(2))
		list.scrollTop = USER_SCROLL_TOP

		rerender(<TodoListDisplay todos={buildTodos(3)} />)

		expect(list.scrollTop).toBe(0)
	})
})
