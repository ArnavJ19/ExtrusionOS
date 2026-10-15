import {readFileSync} from "node:fs";
import {sqlDefinition} from "./historical-schema-fixture.mjs";

export const dispatchReservationCandidate="20261015050000_dispatch_reservation_ledger.sql";
export async function installDispatchReservationLedgerObjects(db) {
  // Extracted definitions/ACL only; never apply the prepared migration wrapper.
  const source=readFileSync(new URL(`../../supabase/migrations/${dispatchReservationCandidate}`,import.meta.url),"utf8");
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(dispatchReservationCandidate,name));
  for(const statement of source.match(/(?:revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length};
}
