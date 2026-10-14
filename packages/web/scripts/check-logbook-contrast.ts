// Derive text contrast from the shipped Logbook tokens, including composited fills.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const css: string = readFileSync(process.cwd() + '/src/index.css', 'utf8')
const declarations: any = (mode: any) => {
  const selector: any = ':root[data-skin="logbook"]' + (mode === 'light' ? '[data-theme="light"]' : '')
  const blocks: any = [...css.matchAll(/([^{}]+)\{([^}]+)\}/g)].filter((m: any) => m[1].trim().endsWith(selector))
  return Object.fromEntries(blocks.flatMap((m: any) => [...m[2].matchAll(/--([\w-]+):\s*([^;]+)\s*;/gi)].map((x: any) => [x[1],x[2].trim()])))
}
const palette: any = (mode: any) => Object.fromEntries(Object.entries(declarations(mode)).filter(([,v]: any)=>/^#[\da-f]{6}$/i.test(v)))
const rgb: any = (hex: any) => [1,3,5].map((i: any) => parseInt(hex.slice(i,i+2),16))
const lum: any = (hex: any) => rgb(hex).map((x: any) => x / 255).map((x: any) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((n: any,x: any,i: any)=>n+x*[.2126,.7152,.0722][i]!,0)
const ratio: any = (a: any,b: any) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)
const mix: any = (a: any,b: any,amount: any) => '#'+rgb(a).map((n: any,i: any)=>Math.round(n*amount+rgb(b)[i]*(1-amount)).toString(16).padStart(2,'0')).join('')
export function contrastRows() {
  const modes: any = ['light','dark'], colors: any = Object.fromEntries(modes.map((mode: any) =>[mode,palette(mode)]))
  const rows: any=[]
  const add: any=(fg: any,bg: any,need: any=4.5)=>rows.push({pair:`${fg} / ${bg}`,need,...Object.fromEntries(modes.map((mode: any) =>[mode,ratio(colors[mode][fg],colors[mode][bg])]))})
  for (const mode of modes) {
    const p: any=colors[mode]
    const d: any=declarations(mode)
    const fill: any=/var\(--acc\) (\d+)%/.exec(d['cur-fill'])
    if (!fill) throw new Error(`Unmeasured current fill: ${d['cur-fill']}`)
    p['current-fill']=mix(p.acc,p.surface,Number(fill[1])/100)
    const edge: any=/var\(--acc\) (\d+)%,transparent/.exec(d['cur-edge'])
    if (!edge && !d['cur-edge'].endsWith('var(--acc)')) throw new Error(`Unmeasured current edge: ${d['cur-edge']}`)
    p['current-edge']=edge?mix(p.acc,p['current-fill'],Number(edge[1])/100):p.acc
    p['accent-tint-bg']=mix(p.acc,p.bg,mode==='light'?.1:.15)
    p['accent-tint-surface']=mix(p.acc,p.surface,mode==='light'?.1:.15)
    p['tag-tint']=mix(p.acc,p.surface,.1)
    p['danger-fill']=mix(p.red,p.surface,.08)
    // Native notification paper follows the system theme, not the in-app override.
    p['notification-paper']=mode==='light'?'#ffffff':'#1C1C1E'
    for (const fg of ['orange','green']) for (const bg of ['bg','surface','surface-2']) for (const percent of [14,16]) {
      p[`${fg}-${percent}-${bg}`]=mix(p[fg],p[bg],percent/100)
    }
  }
  for (const fg of ['label','label-2','label-3','acc-ink']) for (const bg of ['bg','bg-el','surface','surface-2','surface-3','current-fill']) add(fg,bg)
  for (const bg of ['accent-tint-bg','accent-tint-surface']) add('acc-ink',bg)
  add('acc-ink','tag-tint');add('on-acc','acc');add('on-acc-2','acc-2');add('on-orange','orange');add('on-red','red');add('on-purple','purple')
  for (const fg of ['blue','purple']) {add(fg,'surface');add(fg,'surface-2')}
  add('red','danger-fill');add('red','surface');add('orange','surface')
  for (const fg of ['label-4','blue','green','purple','acc']) add(fg,'surface',3)
  add('label-4','current-fill',3)
  add('current-edge','current-fill',3)
  add('current-edge','surface',3)
  add('on-blue','blue')
  add('acc','notification-paper')
  for (const bg of ['bg','surface','surface-2','surface-3','current-fill']) add('yellow',bg)
  for (const fg of ['orange','green']) for (const bg of ['bg','surface','surface-2']) for (const percent of [14,16]) add(`${fg}-ink`,`${fg}-${percent}-${bg}`)
  return rows
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows: any=contrastRows()
  console.log('| Text or UI pair | Light | Dark | Required |\n|---|---:|---:|---:|')
  for (const r of rows) console.log(`| ${r.pair} | ${r.light.toFixed(2)} | ${r.dark.toFixed(2)} | ${r.need} |`)
  const fails: any=rows.filter((r: any) =>r.light<r.need || r.dark<r.need)
  console.log(`\n${rows.length*2} pairs measured; ${fails.length*2} failing pair rows.`)
  if(fails.length)process.exitCode=1
}
