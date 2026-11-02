import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@/components/ui/empty-state") return { EmptyState: () => null };
  if (request === "@/components/ui/error-state") return { ErrorState: () => null };
  if (request === "@/components/ui/loading-skeleton") return { TableLoadingSkeleton: () => null };
  if (request === "@/lib/utils/cn") return { cn: (...values) => values.filter(Boolean).join(" ") };
  if (request === "./sortable-column-header") return { SortableColumnHeader: () => null };
  return originalLoad(request, parent, isMain);
};
const { DataTable, isRowActivationKey } = require("../components/data/data-table.tsx");
Module._load = originalLoad;

test("clickable table rows activate with Enter or Space only", () => {
  assert.equal(isRowActivationKey("Enter"), true);
  assert.equal(isRowActivationKey(" "), true);
  assert.equal(isRowActivationKey("Tab"), false);
  assert.equal(isRowActivationKey("Escape"), false);
});

test("desktop rows guard keyboard activation and mobile identity uses a native button", () => {
  let opens = 0;
  const tree = DataTable({ rows: [{ id: "order-1" }], columns: [{ id: "id", header: "Order", accessor: row => row.id }], getRowId: row => row.id, onRowClick: () => opens++, emptyTitle: "Empty", emptyDescription: "Empty" });
  const rows = [];
  const mobileButtons = [];
  function visit(element) {
    if (!element || typeof element !== "object") return;
    if (["button", "link"].includes(element.props?.role)) rows.push(element);
    if (element.type === "button" && element.props?.onClick) mobileButtons.push(element);
    const children = element.props?.children;
    for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) visit(child);
  }
  visit(tree);
  assert.equal(rows.length, 1);
  assert.equal(mobileButtons.length, 1);
  assert.equal(mobileButtons[0].props.type, "button");
  mobileButtons[0].props.onClick();
  for (const row of rows) {
    assert.equal(row.props.tabIndex, 0);
    const target = {};
    let prevented = false;
    row.props.onKeyDown({ key: " ", target, currentTarget: target, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    row.props.onKeyDown({ key: "Enter", target: {}, currentTarget: target, preventDefault() { throw new Error("Nested control intercepted"); } });
    row.props.onKeyDown({ key: "Tab", target, currentTarget: target, preventDefault() { throw new Error("Tab intercepted"); } });
  }
  assert.equal(opens, 2);
});
