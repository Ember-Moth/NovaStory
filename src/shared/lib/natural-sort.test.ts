import { expect, test } from "vitest";

import { compareNaturalSortText } from "./natural-sort";

function sortNames(names: string[]) {
  return [...names].sort(compareNaturalSortText);
}

test("compareNaturalSortText sorts Arabic digit runs naturally", () => {
  expect(sortNames(["文件10", "文件1", "文件2"])).toEqual(["文件1", "文件2", "文件10"]);
});

test("compareNaturalSortText normalizes full-width digits", () => {
  expect(sortNames(["文件１０", "文件2", "文件１"])).toEqual(["文件１", "文件2", "文件１０"]);
});

test("compareNaturalSortText sorts explicit chapter-style Chinese numerals by value", () => {
  expect(sortNames(["第十章", "第十一章", "第九章"])).toEqual(["第九章", "第十章", "第十一章"]);
});

test("compareNaturalSortText sorts trailing Chinese numeral labels by value", () => {
  expect(sortNames(["文件十", "文件十一", "文件二"])).toEqual(["文件二", "文件十", "文件十一"]);
});

test("compareNaturalSortText keeps ordinary Chinese text on collator ordering", () => {
  const names = ["状态", "角色", "地点"];
  const collator = new Intl.Collator("zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });

  expect(sortNames(names)).toEqual([...names].sort(collator.compare));
});
