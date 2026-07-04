import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SidebarMarkdownTable } from "./SidebarMarkdownTable";

test("SidebarMarkdownTable falls back to the default markdown table for invalid structure", () => {
  const html = renderToStaticMarkup(
    <SidebarMarkdownTable>
      <tbody>
        <tr>
          <td>value</td>
        </tr>
      </tbody>
    </SidebarMarkdownTable>,
  );

  expect(html).toContain('data-streamdown="table-wrapper"');
  expect(html).toContain("ai-table-scrollbar");
  expect(html).not.toContain('data-ai-sidebar-table="root"');
});
