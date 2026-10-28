// A content checkpoint excludes generated build outputs, credentials and evidence files.
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const roots=['app','components','lib','supabase','tests','scripts'];
const files=['package.json','package-lock.json','next.config.ts','tailwind.config.ts','eslint.config.mjs'];
function visit(dir){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const file=path.posix.join(dir,entry.name);
    if(entry.isDirectory()&&!['node_modules','.next','.worktrees'].includes(entry.name))visit(file);
    else if(entry.isFile()&&/\.(?:ts|tsx|mjs|sql)$/.test(file))files.push(file);
  }
}
roots.forEach(visit);
const hash=createHash('sha256');
for(const file of files.sort())hash.update(file+'\0').update(createHash('sha256').update(readFileSync(file)).digest());
console.log(JSON.stringify({files:files.length,sha256:hash.digest('hex')}));
