// PASS2 audit: storage.objects policy probes on native PostgreSQL 18 (synthetic rows; stand-in storage schema from the replay prelude).
import { admin, asUser, cloneDb, dropDb, log, U } from './native-lib.mjs';
const db = cloneDb('w_sto');
try {
  const c = U.company;
  // Supabase grants these on the real storage schema; the replay stand-in does not, so grant them in this clone only.
  admin(db, 'grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;');
  admin(db, `insert into storage.objects(bucket_id,name) values ('reports','${c}/pcda/quote-cost-report.pdf'),('quote-pdfs','${c}/quotes/Q-1.pdf'),('company-assets','${c}/logo.png'),('documents','${c}/dispatches/lr.pdf'),('documents','${c}/technical/spec.pdf'),('technical-drawings','${c}/d1.pdf');`);
  for (const [who, actor] of [['dealer_admin', U.dealer], ['viewer', U.viewer], ['production', U.production], ['inactive', U.inactive], ['foreign-owner', U.foreign]]) {
    const read = await asUser(db, actor, `select coalesce(string_agg(bucket_id||':'||split_part(name,'/',2), ', ' order by bucket_id, name),'(none)') from storage.objects;`);
    const del = await asUser(db, actor, `with d as (delete from storage.objects where bucket_id in ('reports','quote-pdfs','company-assets') returning bucket_id) select coalesce(string_agg(bucket_id, ', ' order by bucket_id),'(none)') from d; rollback; begin;`);
    const ins = await asUser(db, actor, `insert into storage.objects(bucket_id,name) values('company-assets','${c}/planted-by-${who}.html') returning name;`);
    const ovw = await asUser(db, actor, `with u as (update storage.objects set name='${c}/quotes/Q-1-renamed.pdf' where bucket_id='quote-pdfs' returning 1) select count(*) from u; rollback; begin;`);
    log({ id: `ST-${who}`, expect: who === 'dealer_admin' ? 'no internal quote PDFs/reports; no delete' : who === 'viewer' ? 'read-only at most' : '-', canRead: read.out, canDelete: del.out || del.err, canInsertHtml: ins.ok ? ins.out : ins.err, canRenameQuotePdf: ovw.out || ovw.err });
  }
} finally { dropDb(db); }
