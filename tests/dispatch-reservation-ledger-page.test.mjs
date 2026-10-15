import assert from "node:assert/strict";
import test from "node:test";
import {renderToStaticMarkup} from "react-dom/server";
import {createDispatchReservationRenderFixture,dispatchReservationEnvelope,reservationFixtureRow,
  reservationFixtureDispatch as dispatch,reservationFixtureId as id} from "../scripts/lib/dispatch-reservation-render-fixture.mjs";
import {loadDispatchReservationLedgerPage,loadReservationLedgerPage,getReservationLedgerOptions} from "../lib/inventory/reservation-ledger.ts";

const fixture=createDispatchReservationRenderFixture();
test.beforeEach(()=>fixture.reset());

test("dispatch reservations use one complete order-scoped snapshot and ten-row server pages",async()=>{
  const html=await fixture.render();
  assert.deepEqual(fixture.state.calls,[{name:"get_dispatch_reservation_ledger_page",args:{p_dispatch_id:dispatch,p_page:1}}]);
  assert.deepEqual(fixture.state.tables,[]);
  assert.match(html,/601/);assert.match(html,/1,399\.000 kg/);assert.match(html,/4,801\.000 kg/);assert.match(html,/1,800\.000 kg/);
  assert.equal((html.match(/data-reservation-id=/g)??[]).length,10);
  assert.match(html,/499\.000 kg/);assert.match(html,/249\.500 m/);assert.match(html,/499 pieces/);
  assert.match(html,/posted automatically with the dispatch/);
});

test("released and cancelled remainders never appear as active holds and lifecycle evidence remains",async()=>{
  fixture.state.rows=[reservationFixtureRow(10,"released"),reservationFixtureRow(11,"cancelled"),
    {...reservationFixtureRow(12,"consumed"),released_at:"2026-10-15T01:00:00+00:00"}];
  const html=await fixture.render();assert.match(html,/Open holds/);assert.match(html,/Released holds/);
  assert.match(html,/0 active reservations/);assert.match(html,/>Released</);assert.match(html,/>Cancelled</);
  assert.match(html,/Closed 15 Oct 2026/);
  assert.doesNotMatch(html,/12\.000 kg reserved stock is active|6\.000 kg reserved stock is active/);
});

test("failed, missing or thrown reads are unavailable and never become a zero or empty success",async()=>{
  for(const result of [{data:null,error:new Error("private database detail")},{data:null,error:null},{data:{ledger:{rows:[]}},error:null}]){
    fixture.reset();fixture.state.result=result;fixture.state.reservationError=new Error("private database detail");
    const html=await fixture.render();assert.match(html,/reservation.*unavailable/i);
    assert.doesNotMatch(html,/private database detail|No reservations|No active stock reservations|>Open holds</);
  }
  fixture.reset();fixture.state.throwRpc=true;fixture.state.dispatchError=new Error("private dispatch detail");
  const html=await fixture.render();assert.match(html,/reservation.*unavailable/i);assert.doesNotMatch(html,/private .*detail/);
});

test("roles outside reservation read scope perform no reservation lookup on dispatch detail",async()=>{
  const entry=await fixture.panel();
  for(const role of ["viewer","accounts","sales","sales_manager","quality","dealer_admin","dealer_staff"]){
    fixture.reset();fixture.state.role=role;
    const html=renderToStaticMarkup(await entry.type(entry.props));assert.equal(html,"");
    assert.deepEqual(fixture.state.tables,[]);assert.deepEqual(fixture.state.calls,[]);
  }
});

test("page navigation uses the actual dispatch identity and reaches the last record without broadening the order",async()=>{
  const html=await fixture.render({reservationPage:"61"});
  assert.equal(fixture.state.calls[0]?.args.p_page,61);
  assert.match(html,/Page 61 of 61/);assert.match(html,/reservationPage=60/);assert.doesNotMatch(html,/>Next</);
  assert.match(html,/P-1600/);assert.equal((html.match(/data-reservation-id=/g)??[]).length,1);
});

test("unknown legacy metres and pieces remain explicitly unknown",async()=>{
  fixture.state.rows=[{...reservationFixtureRow(),reserved_length_m:null,reserved_pieces:null,consumed_length_m:null,consumed_pieces:null,
    open_length_m:null,open_pieces:null}];
  const html=await fixture.render();assert.match(html,/Metres not captured/);assert.match(html,/Pieces not captured/);
});

test("a verified empty order ledger is distinct from failure and has no phantom next page",async()=>{
  fixture.state.rows=[];
  const html=await fixture.render();assert.match(html,/No reservations/i);assert.doesNotMatch(html,/unavailable|>Next</);
});

test("a mismatched dispatch, order or row identity cannot be rendered as this dispatch's ledger",async()=>{
  for(const change of [data=>({...data,dispatch_id:id(99)}),data=>({...data,order_id:id(99)}),
    data=>({...data,ledger:{...data.ledger,rows:data.ledger.rows.map(row=>({...row,order_id:id(99)}))}})]){
    fixture.reset();fixture.state.result={data:change(dispatchReservationEnvelope(fixture.state.rows)),error:null};
    const html=await fixture.render();assert.match(html,/reservation.*unavailable/i);
  }
});

test("unlinked dispatches show their missing source without claiming zero company commitments",async()=>{
  fixture.state.result={data:{dispatch_id:dispatch,order_id:null,order_number:null,ledger:null},error:null};
  const html=await fixture.render();assert.match(html,/No source order is linked/);
  assert.doesNotMatch(html,/Open holds|No reservations|0 active|unavailable/);
  assert.equal(fixture.state.calls.length,1);assert.deepEqual(fixture.state.tables,[]);
});

test("reservation page parameters are normalized once and remain within the server limit",async()=>{
  for(const [input,expected] of [["0",1],["-1",1],["1.5",1],["NaN",1],["Infinity",1],[["61"],1],["100001",100000],[" 61 ",61]]){
    fixture.reset();const html=await fixture.render({reservationPage:input});
    assert.equal(fixture.state.calls[0]?.args.p_page,expected);
    assert.match(html,expected===1?/Page 1 of 61/:/Page 61 of 61/);
  }
});

test("the dispatch loader rejects invalid request identities and raw page bounds before querying",async()=>{
  const client={rpc(){throw new Error("Invalid request reached transport");}};
  for(const [key,page] of [["invalid",1],[dispatch,0],[dispatch,-1],[dispatch,1.5],[dispatch,100001],[dispatch,NaN],[dispatch,Infinity]]){
    await assert.rejects(loadDispatchReservationLedgerPage(client,key,page),/unavailable for this request/);
  }
});

test("all permitted dispatch reservation roles render and both read permissions are required",async()=>{
  const entry=await fixture.panel();
  for(const role of ["owner","admin","factory_manager","inventory_manager","dispatch_manager","dispatch"]){
    fixture.reset();fixture.state.role=role;
    const html=renderToStaticMarkup(await entry.type(entry.props));assert.match(html,/Order reservation ledger/);
    assert.equal(fixture.state.calls.length,1);
  }
  for(const role of ["production","production_manager"]){
    fixture.reset();fixture.state.role=role;
    assert.equal(renderToStaticMarkup(await entry.type(entry.props)),"");assert.equal(fixture.state.calls.length,0);
  }
});

test("conflicting row quantities, summary evidence and page identities cannot be displayed as verified",async()=>{
  const base=dispatchReservationEnvelope([reservationFixtureRow()]);
  const variants=[
    data=>({...data,order_id:null}),
    data=>({...data,ledger:null}),
    data=>({...data,order_number:"Another order"}),
    data=>({...data,ledger:{...data.ledger,integrity_ok:false}}),
    data=>({...data,ledger:{...data.ledger,rows:[]}}),
    data=>({...data,ledger:{...data.ledger,summary:{...data.ledger.summary,open_weight_kg:600}}}),
    data=>({...data,ledger:{...data.ledger,summary:{...data.ledger.summary,consumed_weight_kg:0}}}),
    data=>({...data,ledger:{...data.ledger,summary:{...data.ledger.summary,released_weight_kg:6}}})
  ];
  for(const patch of [{status:"released"},{status:"consumed"},{status:null},{reserved_weight_kg:Infinity},
    {consumed_weight_kg:11},{open_weight_kg:2},{open_length_m:2},{open_pieces:2},{consumed_pieces:1.5},
    {reserved_pieces:Number.MAX_SAFE_INTEGER+1},{released_weight_kg:6},{created_at:"not a date"}]){
    variants.push(data=>({...data,ledger:{...data.ledger,rows:[{...data.ledger.rows[0],...patch}]}}));
  }
  for(const change of variants){
    fixture.reset();fixture.state.result={data:change(structuredClone(base)),error:null};
    assert.match(await fixture.render(),/reservation.*unavailable/i);
  }
  fixture.reset();fixture.state.result={data:dispatchReservationEnvelope(fixture.state.rows,1),error:null};
  assert.match(await fixture.render({reservationPage:"2"}),/reservation.*unavailable/i);
  const globalClient={rpc:async()=>({data:dispatchReservationEnvelope(fixture.state.rows,1).ledger,error:null})};
  await assert.rejects(loadReservationLedgerPage(globalClient,getReservationLedgerOptions({page:"2"})),/unavailable|incomplete/);
});
