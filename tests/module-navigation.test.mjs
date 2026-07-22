import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import {
  getCurrentModule,
  getIntraModuleNeighbors,
  getModulePageLabel,
  updateIntraModuleHistory,
} from "../lib/navigation/module-navigation.ts";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quotes", label: "Quotes" },
  { href: "/orders", label: "Orders" },
  { href: "/reports", label: "Reports", aliases: ["/report-builder"] },
  { href: "/dispatches", label: "Dispatches", aliases: ["/shipments"] },
  { href: "/settings", label: "Settings" },
  { href: "/settings/access", label: "Users & Roles" },
];

describe("intra-module navigation", () => {
  it("keeps overview, database, create, detail, and edit pages in their parent module", () => {
    for (const pathname of ["/quotes", "/quotes/database", "/quotes/new", "/quotes/id-1", "/quotes/id-1/edit"]) {
      assert.equal(getCurrentModule(pathname, items)?.item.href, "/quotes");
    }
  });

  it("moves backward and forward only through pages visited inside one module", () => {
    let history = updateIntraModuleHistory(undefined, "/quotes", "/quotes");
    history = updateIntraModuleHistory(history, "/quotes", "/quotes/database");
    history = updateIntraModuleHistory(history, "/quotes", "/quotes/quote-42");

    assert.deepEqual(getIntraModuleNeighbors(history), {
      previous: "/quotes/database",
      next: null,
    });

    history = updateIntraModuleHistory(history, "/quotes", "/quotes/database");
    assert.deepEqual(getIntraModuleNeighbors(history), {
      previous: "/quotes",
      next: "/quotes/quote-42",
    });
  });

  it("starts a separate trail when the active module changes", () => {
    const quoteHistory = updateIntraModuleHistory(undefined, "/quotes", "/quotes/database");
    const orderHistory = updateIntraModuleHistory(quoteHistory, "/orders", "/orders/record-1");

    assert.deepEqual(orderHistory.entries, ["/orders/record-1"]);
    assert.deepEqual(getIntraModuleNeighbors(orderHistory), { previous: null, next: null });
  });

  it("uses the longest module prefix and keeps cross-prefix workflows attached", () => {
    assert.equal(getCurrentModule("/settings/access/invitations", items)?.item.href, "/settings/access");
    assert.equal(getCurrentModule("/report-builder", items)?.item.href, "/reports");
    assert.equal(getCurrentModule("/shipments/dispatch-1/receipt", items)?.item.href, "/dispatches");
  });

  it("labels the current location without exposing record identifiers", () => {
    const quotes = getCurrentModule("/quotes/quote-42/edit", items);
    const production = getCurrentModule("/orders/database", items);

    assert.equal(quotes && getModulePageLabel("/quotes/quote-42/edit", quotes), "Edit record");
    assert.equal(production && getModulePageLabel("/orders/database", production), "Database");
  });

  it("renders module-local controls from the role and feature filtered module list", async () => {
    const [shell, navigator] = await Promise.all([
      readFile(new URL("../components/layout/app-shell.tsx", import.meta.url), "utf8"),
      readFile(new URL("../components/layout/module-navigator.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(shell, /hasRouteAccess\(item\.href, context\.role\)/);
    assert.match(shell, /isFeatureEnabled\(featureFlags, item\.module\)/);
    assert.match(shell, /<ModuleNavigator items=\{moduleNavigation\}/);
    assert.match(navigator, /Previous in \$\{moduleLabel\}/);
    assert.match(navigator, /Next in \$\{moduleLabel\}/);
    assert.doesNotMatch(navigator, /Previous module|Next module/);
  });
});
