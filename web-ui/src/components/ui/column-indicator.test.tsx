import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColumnIndicator } from "./column-indicator";

describe("ColumnIndicator", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	it("renders an SVG for todo", async () => {
		await act(async () => {
			root.render(<ColumnIndicator columnId="todo" />);
		});
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(container.querySelector("circle")).not.toBeNull();
		expect(container.querySelector("path")).toBeNull();
	});

	it("renders an SVG for done", async () => {
		await act(async () => {
			root.render(<ColumnIndicator columnId="done" />);
		});
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		// done = filled circle (circle element, no path)
		expect(container.querySelector("circle")).not.toBeNull();
		expect(container.querySelector("path")).toBeNull();
	});

	it("renders an SVG for in_progress (existing)", async () => {
		await act(async () => {
			root.render(<ColumnIndicator columnId="in_progress" />);
		});
		// in_progress = circle + half-filled path
		expect(container.querySelector("path")).not.toBeNull();
	});
});
