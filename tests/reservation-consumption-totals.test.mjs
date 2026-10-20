import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadReservationConsumptionTotals } from "../lib/inventory/reservation-consumption.ts";

describe("complete reservation consumption reads",()=>{
  const row=id=>({reservation_id:id,consumed_weight_kg:"10.125",consumed_length_m:"5.25",consumed_pieces:2});
  it("reads 1,001 unique reservations in bounded requests and preserves all totals",async()=>{
    const ids=Array.from({length:1001},(_,n)=>`reservation-${n}`),sizes=[];
    const client={async rpc(name,{p_reservation_ids}){
      assert.equal(name,"get_profile_stock_consumption_totals");sizes.push(p_reservation_ids.length);
      return {data:p_reservation_ids.map(row),error:null};
    }};
    const totals=await loadReservationConsumptionTotals(client,[...ids,ids[0]]);
    assert.deepEqual(sizes,[500,500,1]);assert.equal(totals.size,1001);
    assert.deepEqual(totals.get(ids[1000]),{weightKg:10.125,lengthM:5.25,pieces:2});
  });

  it("does not query empty requests and propagates a failed later page",async()=>{
    assert.equal((await loadReservationConsumptionTotals({rpc(){throw new Error("Unexpected query");}},[])).size,0);
    let requests=0;const error=new Error("Second page unavailable");
    await assert.rejects(loadReservationConsumptionTotals({async rpc(name,{p_reservation_ids}){
      requests++;return requests===1?{data:p_reservation_ids.map(row),error:null}:{data:null,error};
    }},Array.from({length:501},(_,n)=>`r${n}`)),error);
  });

  it("rejects truncated, foreign, duplicate or invalid results instead of assuming no consumption",async()=>{
    for(const data of [null,[],[null],[[]],["invalid"],[row("foreign")],[row("r1"),row("r1")],[{...row("r1"),consumed_weight_kg:null}],
      [{...row("r1"),consumed_length_m:-1}],[{...row("r1"),consumed_pieces:0.5}],[{...row("r1"),consumed_weight_kg:"NaN"}]]) {
      await assert.rejects(loadReservationConsumptionTotals({rpc:async()=>({data,error:null})},["r1"]),/incomplete|invalid/);
    }
    await assert.rejects(loadReservationConsumptionTotals({rpc:async()=>({data:[row("r1"),row("r1")],error:null})},["r1","r2"]),/invalid/);
  });
});
