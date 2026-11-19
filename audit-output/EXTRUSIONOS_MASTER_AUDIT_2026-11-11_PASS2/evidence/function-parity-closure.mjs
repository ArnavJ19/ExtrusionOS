import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
for (const fn of ['bulk_queue_command', 'procedure_effectiveness_command', 'procedure_version_command']) {
  let last = null;
  for (const f of files) {
    const s = readFileSync('supabase/migrations/' + f, 'utf8');
    const re = new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.' + fn + '\\s*\\(', 'ig');
    let m; while ((m = re.exec(s))) {
      const rest = s.slice(m.index);
      const tag = rest.match(/\sas\s+(\$[a-z_]*\$)/i);
      if (!tag) continue;
      const start = rest.indexOf(tag[1]) + tag[1].length, end = rest.indexOf(tag[1], start);
      last = { f, body: rest.slice(start, end) };
    }
  }
  const norm = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, '');
  const ws = (b) => b.replace(/\s+/g, '');
  console.log(fn, last.f, 'len', last.body.length, 'nocomment_nows', createHash('md5').update(norm(last.body)).digest('hex'), 'nows', createHash('md5').update(ws(last.body)).digest('hex'), 'CR', /\r/.test(last.body));
}
