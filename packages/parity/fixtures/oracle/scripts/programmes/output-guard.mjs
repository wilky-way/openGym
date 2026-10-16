// One guard for every file these tools write. Output holds private library data, so it must not
// land anywhere git could pick it up: judged on real paths, never on how the path is spelled.
import {realpathSync,existsSync,statSync,writeFileSync,unlinkSync} from 'node:fs'
import {basename,dirname,join,resolve,sep,isAbsolute,parse} from 'node:path'
import {fileURLToPath} from 'node:url'
const thisRepo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const fold=p=>process.platform==='darwin'||process.platform==='win32'?p.toLowerCase():p
const inside=(p,root)=>fold(p)===fold(root)||fold(p).startsWith(fold(root).replace(/[\\/]+$/,'')+sep)
const isDir=p=>{try{return statSync(p).isDirectory()}catch{return false}}
const isBareRepo=d=>existsSync(join(d,'HEAD'))&&isDir(join(d,'objects'))&&isDir(join(d,'refs'))

/** Resolve existing components before applying `..`. Bun's realpath normalizes a whole
 * path lexically first, which can hide a symlink into a checkout followed by `..`.
 * Resolve one component at a time so each runtime observes the filesystem order. */
export function realOutputPath(target) {
  const dir=dirname(target), absolute=isAbsolute(dir)?dir:process.cwd()+sep+dir
  const root=parse(absolute).root
  let current=realpathSync.native(root), missing=false
  const components=absolute.slice(root.length).split(process.platform==='win32'?/[\\/]+/:/\/+/)
  for(const part of components) {
    if(!part)continue
    if(part==='.'||part==='..') {
      if(missing)throw Object.assign(new Error('Unresolvable output parent'),{code:'ENOENT'})
      if(part==='..')current=dirname(current)
      continue
    }
    const next=join(current,part)
    if(missing) {current=next;continue}
    try {current=realpathSync.native(next)} catch(e) {
      if(e.code!=='ENOENT')throw e
      current=next;missing=true
    }
  }
  return join(current,basename(target))
}

/** The git work tree, git dir or bare repo that holds `real`, or null. Walks up looking for `.git` or bare markers. */
function enclosingGit(real) {
  for(let dir=dirname(real);;dir=dirname(dir)) {
    if(existsSync(join(dir,'.git'))||isBareRepo(dir)||basename(dir)==='.git')return dir
    if(dirname(dir)===dir)return null
  }
}

function check(target,real,repo) {
  const roots=[repo].filter(Boolean).map(r=>{try{return realpathSync.native(r)}catch{return null}}).filter(Boolean)
  if(enclosingGit(real)||roots.some(r=>inside(real,r)))throw new Error(`Refusing to write ${target}: output holds private data and must stay outside every checkout of this repository.`)
}

/** Validate `target` and return the canonical path to write to. Callers must write to the returned path. */
export function assertOutsideRepository(target, {repo=thisRepo}={}) {
  const real=realOutputPath(target)
  check(target,real,repo)
  return real
}

/** Validate, exclusively create at the canonical path, then re-verify what was actually created (parent-swap race). */
export function writeOutsideRepository(target, content, {repo=thisRepo,mode=0o600,beforeCreate}={}) {
  const real=assertOutsideRepository(target,{repo})
  beforeCreate?.(real) // test seam: lets a test swap the parent between check and create
  writeFileSync(real,content,{flag:'wx',mode})
  try {
    const landed=realpathSync.native(real)
    check(target,landed,repo)
  } catch(e) {
    try {unlinkSync(real)} catch {/* already gone */}
    try {unlinkSync(realpathSync.native(real))} catch {/* ditto */}
    throw e
  }
  return real
}
