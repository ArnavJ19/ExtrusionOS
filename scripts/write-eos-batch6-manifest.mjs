import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';

const base='09b337b453c2ff3ff044c2d401b3569564c70b51';
const root=process.cwd(),out=resolve('docs/evidence/EOS_UPGRADE_BATCH_6');mkdirSync(out,{recursive:true});
const windowsGit=resolve(process.env.ProgramFiles||'C:/Program Files','Git/cmd/git.exe');
const gitExecutable=process.env.GIT_EXECUTABLE||(process.platform==='win32'&&existsSync(windowsGit)?windowsGit:'git');
const git=args=>execFileSync(gitExecutable,args,{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const tracked=git(['diff','--name-only',base,'--','app','components','lib','proxy.ts','UPGRADE_EOS.md','tests','scripts/lib/retained-invoice-actions-fixture.mjs']);
const ownedUntracked=git(['ls-files','--others','--exclude-standard']).filter(path=>
  /^(app|components|lib)\//.test(path)
  || /^supabase\/migrations\/202610291[1-5]\d+_/.test(path)
  || /^tests\/(configuration-release|eos-batch6|factory-planning|financial-correction-action|financial-workflow-review|master-cleanup|partial-(return-assurance|line-quantity-sql)|practice-(workspace|transactions)|purchase-lifecycle)/.test(path)
  || /^scripts\/lib\/(configuration-release|eos-batch6|factory-planning|financial-workflow-review|purchase-lifecycle)/.test(path)
  || /^scripts\/(capture-eos-batch6-browser-evidence|write-eos-batch6-manifest)\.mjs$/.test(path)
  || /^docs\/EOS_BATCH6_/.test(path) || /^docs\/evidence\/EOS_UPGRADE_BATCH_6\//.test(path)
  || path==='EOS_UPGRADE_BATCH_6.md');
const prior=existsSync(resolve(out,'source-manifest.json'))?JSON.parse(readFileSync(resolve(out,'source-manifest.json'),'utf8')).commit_paths:[];
const commitPaths=[...new Set([...tracked,...ownedUntracked,...prior])].filter(path=>existsSync(resolve(path))).sort();
for(const path of commitPaths){const full=resolve(path),local=relative(root,full);
  if(full===root||local.startsWith('..'+sep)||local==='..'||/^(\.git|\.env)(\/|\.|$)/.test(path))throw Error(`Out-of-scope manifest path: ${path}`);
}
const dependencyPaths=['package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs'];
const sourcePaths=[...new Set([...commitPaths.filter(path=>/\.(ts|tsx|mjs|sql)$/.test(path)),...dependencyPaths])].sort();
const files=sourcePaths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex')}));
const digest=createHash('sha256').update(files.map(file=>`${file.path}\0${file.sha256}\n`).join('')).digest('hex');
const document={base_commit:base,generated_at:new Date().toISOString(),hash_basis:'UTF-8 text normalized to LF; sorted path-NUL-filehash records',
  source_digest:digest,source_files:files,commit_paths:[...new Set([...commitPaths,'docs/evidence/EOS_UPGRADE_BATCH_6/source-manifest.json','docs/evidence/EOS_UPGRADE_BATCH_6/commit-paths.txt'])].sort()};
writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(document,null,2)+'\n');
writeFileSync(resolve(out,'commit-paths.txt'),document.commit_paths.join('\n')+'\n');
console.log(JSON.stringify({source_files:files.length,source_digest:digest,commit_paths:document.commit_paths.length}));
