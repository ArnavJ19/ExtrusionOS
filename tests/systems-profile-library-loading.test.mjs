import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCompleteSystemProfileSeries } from "../lib/systems-configurator/profile-library.ts";

const repoRoot = process.cwd();
const newPage = readFileSync(join(repoRoot, "app/(dashboard)/systems-configurator/new/page.tsx"), "utf8");
const editPage = readFileSync(join(repoRoot, "app/(dashboard)/systems-configurator/projects/[id]/edit/page.tsx"), "utf8");
const configuratorForm = readFileSync(join(repoRoot, "components/modules/systems-configurator/configurator-form.tsx"), "utf8");
const actions = readFileSync(join(repoRoot, "lib/systems-configurator/actions.ts"), "utf8");

test("complete series loading paginates until every profile mapping is returned", async () => {
  const sourceRows = Array.from({ length: 450 }, (_, index) => ({ id: `mapping-${index + 1}`, series_id: "series-a" }));
  const ranges = [];
  const filters = [];
  const supabase = {
    from(table) {
      assert.equal(table, "system_profiles");
      const query = {
        select() { return query; },
        eq(field, value) { filters.push([field, value]); return query; },
        order() { return query; },
        async range(from, to) {
          ranges.push([from, to]);
          return { data: sourceRows.slice(from, to + 1), error: null };
        }
      };
      return query;
    }
  };

  const rows = await loadCompleteSystemProfileSeries(supabase, "company-a", "series-a");
  assert.equal(rows.length, 450);
  assert.deepEqual(ranges, [[0, 199], [200, 399], [400, 599]]);
  assert.deepEqual(filters.slice(0, 2), [["company_id", "company-a"], ["series_id", "series-a"]]);
});

test("new and edit pages load only the complete selected series without a fixed 500 cap", () => {
  assert.doesNotMatch(newPage, /system_profiles[\s\S]*?\.limit\(500\)/);
  assert.doesNotMatch(editPage, /system_profiles[\s\S]*?\.limit\(500\)/);
  assert.match(newPage, /loadCompleteSystemProfileSeries\(supabase, context\.companyId, initialSeriesId\)/);
  assert.match(editPage, /loadCompleteSystemProfileSeries\(supabase, context\.companyId, configuration\.series_id \?\? ""\)/);
  assert.match(editPage, /selectedSeriesRow && !availableSeries\.some/);
});

test("series changes use a guarded server loader and replace the form mapping library", () => {
  assert.match(actions, /export async function loadSystemProfilesForSeriesAction/);
  assert.match(actions, /getSystemsConfiguratorContext\("read"\)/);
  assert.match(actions, /\.eq\("company_id", context\.companyId\)[\s\S]*?\.eq\("id", seriesId\)/);
  assert.match(configuratorForm, /loadSystemProfilesForSeriesAction\(selectedSeriesId\)/);
  assert.match(configuratorForm, /setLoadedSystemProfiles\(result\.data\)/);
  assert.match(configuratorForm, /Retry profile library/);
});

test("BOM calculation uses the same complete-series loader", () => {
  const calculateAction = actions.slice(actions.indexOf("export async function calculateSystemConfigurationProject"));
  assert.match(calculateAction, /loadCompleteSystemProfileSeries\(supabase, context\.companyId, configuration\.series_id\)/);
  assert.match(calculateAction, /const activeSystemProfiles = systemProfiles\.filter/);
  assert.doesNotMatch(calculateAction, /from\("system_profiles"\)/);
});
