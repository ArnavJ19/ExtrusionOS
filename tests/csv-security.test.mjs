import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeCsvCell, neutralizeSpreadsheetFormula, recordsToCsv } from "../lib/utils/csv.ts";

describe("spreadsheet export safety", () => {
  it("neutralizes formula prefixes including leading whitespace", () => {
    for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =HYPERLINK(\"https://example.com\")"]) {
      assert.equal(neutralizeSpreadsheetFormula(value).startsWith("'"), true);
    }
  });

  it("escapes CSV syntax after formula neutralization", () => {
    assert.equal(escapeCsvCell('=HYPERLINK("https://example.com", "open")'), '"\'=HYPERLINK(""https://example.com"", ""open"")"');
    assert.equal(escapeCsvCell("ordinary"), "ordinary");
  });

  it("applies protection to headers and records", () => {
    const csv = recordsToCsv(["name", "=unsafe"], [{ name: "+payload", "=unsafe": "ok" }]);
    assert.equal(csv, "name,'=unsafe\n'+payload,ok");
  });
});
