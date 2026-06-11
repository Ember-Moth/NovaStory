import { expect, test } from "bun:test";

import {
  beginRowPointerGesture,
  canStartRowPointerGesture,
  resolveRowPointerRelease,
  updateRowPointerGesture,
} from "./useRowPointerGesture";

test("canStartRowPointerGesture only accepts primary mouse clicks without modifiers", () => {
  expect(
    canStartRowPointerGesture({
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBe(true);

  expect(
    canStartRowPointerGesture({
      pointerType: "touch",
      button: 0,
      buttons: 1,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBe(false);

  expect(
    canStartRowPointerGesture({
      pointerType: "mouse",
      button: 2,
      buttons: 2,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBe(false);
});

test("updateRowPointerGesture starts dragging after the movement threshold", () => {
  const active = beginRowPointerGesture({
    pointerId: 1,
    scope: "content",
    rowId: "content_1",
    hitArea: "label",
    x: 10,
    y: 20,
  });

  const withinThreshold = updateRowPointerGesture(active, { x: 13, y: 20 });
  expect(withinThreshold.startedDrag).toBe(false);
  expect(withinThreshold.next.dragging).toBe(false);

  const beyondThreshold = updateRowPointerGesture(active, { x: 15, y: 20 });
  expect(beyondThreshold.startedDrag).toBe(true);
  expect(beyondThreshold.next.dragging).toBe(true);
});

test("resolveRowPointerRelease returns a click candidate for the first label click", () => {
  const active = beginRowPointerGesture({
    pointerId: 1,
    scope: "content",
    rowId: "content_1",
    hitArea: "label",
    x: 10,
    y: 20,
  });

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate: null,
    x: 11,
    y: 20,
    timeStamp: 100,
  });

  expect(result.kind).toBe("click-candidate");
  expect(result.nextClickCandidate).toEqual({
    scope: "content",
    rowId: "content_1",
    hitArea: "label",
    timeStamp: 100,
    x: 11,
    y: 20,
  });
});

test("resolveRowPointerRelease recognizes a second nearby label click as a double click", () => {
  const previousClickCandidate = {
    scope: "content",
    rowId: "content_1",
    hitArea: "label" as const,
    timeStamp: 100,
    x: 11,
    y: 20,
  };
  const active = beginRowPointerGesture({
    pointerId: 2,
    scope: "content",
    rowId: "content_1",
    hitArea: "label",
    x: 12,
    y: 21,
  });

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate,
    x: 13,
    y: 21,
    timeStamp: 350,
  });

  expect(result.kind).toBe("double-click");
  expect(result.nextClickCandidate).toBeNull();
});

test("resolveRowPointerRelease rejects clicks outside the label hit area", () => {
  const previousClickCandidate = {
    scope: "content",
    rowId: "content_1",
    hitArea: "label" as const,
    timeStamp: 100,
    x: 11,
    y: 20,
  };
  const active = beginRowPointerGesture({
    pointerId: 2,
    scope: "content",
    rowId: "content_1",
    hitArea: null,
    x: 12,
    y: 21,
  });

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate,
    x: 13,
    y: 21,
    timeStamp: 200,
  });

  expect(result.kind).toBe("none");
  expect(result.nextClickCandidate).toBeNull();
});

test("resolveRowPointerRelease resets the click candidate after the double click interval", () => {
  const previousClickCandidate = {
    scope: "content",
    rowId: "content_1",
    hitArea: "label" as const,
    timeStamp: 100,
    x: 11,
    y: 20,
  };
  const active = beginRowPointerGesture({
    pointerId: 2,
    scope: "content",
    rowId: "content_1",
    hitArea: "label",
    x: 12,
    y: 21,
  });

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate,
    x: 13,
    y: 21,
    timeStamp: 401,
  });

  expect(result.kind).toBe("click-candidate");
  expect(result.nextClickCandidate?.timeStamp).toBe(401);
});

test("resolveRowPointerRelease does not double click across gesture scopes", () => {
  const previousClickCandidate = {
    scope: "aux",
    rowId: "shared_1",
    hitArea: "label" as const,
    timeStamp: 100,
    x: 11,
    y: 20,
  };
  const active = beginRowPointerGesture({
    pointerId: 2,
    scope: "content",
    rowId: "shared_1",
    hitArea: "label",
    x: 12,
    y: 21,
  });

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate,
    x: 13,
    y: 21,
    timeStamp: 200,
  });

  expect(result.kind).toBe("click-candidate");
  expect(result.nextClickCandidate?.scope).toBe("content");
});

test("resolveRowPointerRelease does not create click candidates after a drag", () => {
  const active = {
    ...beginRowPointerGesture({
      pointerId: 1,
      scope: "content",
      rowId: "content_1",
      hitArea: "label",
      x: 10,
      y: 20,
    }),
    dragging: true,
  };

  const result = resolveRowPointerRelease({
    active,
    previousClickCandidate: null,
    x: 30,
    y: 40,
    timeStamp: 200,
  });

  expect(result.kind).toBe("drag-end");
  expect(result.nextClickCandidate).toBeNull();
});
