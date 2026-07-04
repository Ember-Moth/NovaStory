import { expect, test } from "vitest";

import { isPanelBlankAreaDropTarget } from "./panelBlankAreaDrop";

test("blank-area drop is allowed after the last visible row inside the panel drop zone", () => {
  expect(
    isPanelBlankAreaDropTarget({
      hitPanelDropZone: true,
      pointY: 181,
      lastVisibleRowBottom: 180,
    }),
  ).toBe(true);
});

test("blank-area drop is rejected while the pointer is still within the visible rows", () => {
  expect(
    isPanelBlankAreaDropTarget({
      hitPanelDropZone: true,
      pointY: 179,
      lastVisibleRowBottom: 180,
    }),
  ).toBe(false);
});

test("blank-area drop is rejected outside the panel drop zone", () => {
  expect(
    isPanelBlankAreaDropTarget({
      hitPanelDropZone: false,
      pointY: 220,
      lastVisibleRowBottom: 180,
    }),
  ).toBe(false);
});

test("blank-area drop is rejected when no visible row boundary is available", () => {
  expect(
    isPanelBlankAreaDropTarget({
      hitPanelDropZone: true,
      pointY: 220,
      lastVisibleRowBottom: null,
    }),
  ).toBe(false);
});
