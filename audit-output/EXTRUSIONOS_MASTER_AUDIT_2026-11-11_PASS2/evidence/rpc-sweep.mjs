// PASS2 audit: call every SECURITY DEFINER public function that `authenticated` may execute as (1) a signed-in account with
// no staff row, (2) a suspended staff user and (3) a viewer, with empty arguments, and bucket the response.
// A returned value (no error) for the first two actors is a lead that needs manual review. Native PostgreSQL 18, synthetic data.
import { admin, cloneDb, dropDb, log, nid, session, asUserSql, U } from './native-lib.mjs';
const db = cloneDb('w_rpc');
try {
  const stranger = nid(9998);
  admin(db, `insert into auth.users(id,email) values('${stranger}','stranger@audit.invalid');`);
  const fns = JSON.parse(admin(db, `select json_agg(json_build_object('name',p.proname,'args',(select coalesce(json_agg(format_type(t,null) order by o),'[]') from unnest(p.proargtypes) with ordinality x(t,o)),'ret',format_type(p.prorettype,null),'setof',p.proretset) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prokind='f' and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')`));
  const arg = (t) => t === 'jsonb' || t === 'json' ? `'{}'::${t}` : t === 'text' ? `'list'::text` : t.endsWith('[]') ? `'{}'::${t}` : `null::${t}`;
  const summary = {}; const leads = [];
  for (const [who, actor] of [['stranger', stranger], ['inactive', U.inactive], ['viewer', U.viewer]]) {
    summary[who] = { refused_permission: 0, refused_other: 0, returned: 0 };
    for (const f of fns) {
      const call = `select ${f.setof ? 'count(*) from' : ''} public.${f.name}(${f.args.map(arg).join(',')})${f.setof ? ' s' : ''};`;
      const r = await session(db, asUserSql(actor, call));
      if (!r.ok) { summary[who][/permission|not permitted|authentication|not authori[sz]ed|access|42501|not allowed|sign in|inactive|no active/i.test(r.err) ? 'refused_permission' : 'refused_other']++; if (who !== 'viewer' && !/permission|not permitted|authentication|not authori[sz]ed|access|not allowed|sign in|inactive|no active/i.test(r.err)) leads.push({ who, fn: f.name, kind: 'non-permission error first', err: r.err.slice(0, 110) }); }
      else { summary[who].returned++; const v = r.out.split('\n').slice(1).join(' ').slice(0, 140); if (who !== 'viewer') leads.push({ who, fn: f.name, kind: 'returned', value: v }); }
    }
  }
  log({ id: 'RPC-sweep', functions: fns.length, summary });
  for (const l of leads) log(l);
} finally { dropDb(db); }
