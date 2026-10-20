import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canSubmitQuoteOrder, loadQuoteDealerAvailability } from "../lib/orders/quote-fulfillment.ts";

describe("quote order fulfillment availability", () => {
  it("requests one authorized aggregate without reading protected reservation rows", async () => {
    const calls = [];
    const client = { async rpc(name, args) { calls.push([name,args]); return { data:"20.125", error:null }; } };
    assert.equal(await loadQuoteDealerAvailability(client,"quote-1"),20.125);
    assert.deepEqual(calls,[["get_dealer_quote_stock_availability",{ p_quote_id:"quote-1" }]]);
  });

  it("accepts verified empty stock while rejecting unavailable or malformed balances", async () => {
    assert.equal(await loadQuoteDealerAvailability({rpc:async()=>({data:0,error:null})},"quote-1"),0);
    for (const data of [null,undefined,"",false,[],{},-1,"NaN",Infinity]) {
      await assert.rejects(loadQuoteDealerAvailability({rpc:async()=>({data,error:null})},"quote-1"),/availability is unavailable/);
    }
    const error = new Error("Schema unavailable");
    await assert.rejects(loadQuoteDealerAvailability({rpc:async()=>({data:0,error})},"quote-1"),error);
  });

  it("allows verified below-minimum orders into the consolidation queue", () => {
    assert.equal(canSubmitQuoteOrder({quoteSelected:true,saving:false,availabilityLoading:false,availabilityError:null}),true);
  });

  it("blocks creation without a selection or while balances are loading, failed, or saving", () => {
    const ready = {quoteSelected:true,saving:false,availabilityLoading:false,availabilityError:null};
    for (const state of [{quoteSelected:false},{saving:true},{availabilityLoading:true},{availabilityError:"Stock unavailable"}]) {
      assert.equal(canSubmitQuoteOrder({...ready,...state}),false);
    }
  });
});
