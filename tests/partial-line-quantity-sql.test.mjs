import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('29: the real packing trigger caps cumulative units across distinct dispatches and guards updates',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create schema private;create role anon;create role authenticated;
      create table order_items(id int primary key,company_id int,order_id int,profile_id int,quantity_pieces numeric,length_per_piece_m numeric,manufacturing_weight_kg numeric,quantity_kg numeric,section_weight_kg_per_m numeric);
      create table dispatches(id int primary key,company_id int,order_id int);
      create table packing_list_items(id int primary key,company_id int,dispatch_id int,order_item_id int,profile_id int,number_of_pieces numeric,net_length_m numeric);
      insert into order_items values(1,1,1,1,200,6,960,960,0.8),(2,1,1,1,10,6,48,48,0.8);
      insert into dispatches values(1,1,1),(2,1,1),(3,1,1),(4,1,1);`);
    const migration=readFileSync('supabase/migrations/20261029141000_partial_line_balances.sql','utf8');
    // Use UUID row types as the production trigger does, with deterministic integer fixtures converted below.
    await db.exec(`alter table order_items alter id type uuid using md5(id::text)::uuid,alter company_id type uuid using md5(company_id::text)::uuid,alter order_id type uuid using md5(order_id::text)::uuid,alter profile_id type uuid using md5(profile_id::text)::uuid;
      alter table dispatches alter id type uuid using md5(id::text)::uuid,alter company_id type uuid using md5(company_id::text)::uuid,alter order_id type uuid using md5(order_id::text)::uuid;
      alter table packing_list_items alter id type uuid using md5(id::text)::uuid,alter company_id type uuid using md5(company_id::text)::uuid,alter dispatch_id type uuid using md5(dispatch_id::text)::uuid,alter order_item_id type uuid using md5(order_item_id::text)::uuid,alter profile_id type uuid using md5(profile_id::text)::uuid;`);
    await db.exec(migration.slice(migration.indexOf('create index'),migration.indexOf('-- Correct')));
    const insert=(id,dispatch,pieces,metres,line=1)=>db.query('insert into packing_list_items values(md5($1)::uuid,md5($2)::uuid,md5($3)::uuid,md5($4)::uuid,md5($2)::uuid,$5,$6)',[String(id),'1',String(dispatch),String(line),pieces,metres]);
    await insert(1,1,60,360);await insert(2,2,100,600);await insert(3,3,40,240);
    assert.equal(Number((await db.query('select sum(number_of_pieces) n from packing_list_items')).rows[0].n),200);
    await assert.rejects(insert(4,4,1,6),/Cumulative packed pieces/);
    await assert.rejects(db.query("update packing_list_items set number_of_pieces=101 where id=md5('2')::uuid"),/Cumulative packed pieces/);
    await assert.rejects(db.query("update packing_list_items set net_length_m=601 where id=md5('2')::uuid"),/Cumulative packed metres/);
    await insert(5,4,10,60,2);
    assert.equal(Number((await db.query("select sum(number_of_pieces) n from packing_list_items where order_item_id=md5('1')::uuid")).rows[0].n),200);
  }finally{await db.close();}
});
