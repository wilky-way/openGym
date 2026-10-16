// A deliberately small, static Liftoscript reader. Source is data: it is never
// evaluated, imported, or used to calculate an athlete's load. Unknown grammar
// fails closed rather than being guessed from a program's name.
const array = value => Array.isArray(value) ? value : []
const compact = text => text.replace(/\bstate\./g, '').replace(/\s+/g, '')
const clipped = text => /\.\.\.|…/.test(text)
const number = (value, unit = '') => ({ type: 'number', value, unit })
const fail = message => { throw new Error(message) }
const cap = text => text.charAt(0).toUpperCase() + text.slice(1)
const amount = node => `${node.value}${node.unit ? ` ${node.unit}` : ''}`

function custom(text) {
  if (typeof text !== 'string') return null
  const match = text.trim().match(/^custom\(([^)]*)\)\s*(?:reusing\s+['"]([^'"]+)['"]\s*)?([\s\S]*)$/)
  if (!match) return null
  const params = Object.create(null)
  for (const entry of match[1].split(',').filter(s => s.trim())) {
    const p = entry.trim().match(/^([a-zA-Z_]\w*)\s*:\s*(-?\d+(?:\.\d+)?)\s*(lb|kg|%)?$/)
    if (!p) fail('A rule parameter could not be read.')
    params[p[1]] = number(Number(p[2]), p[3] || '')
  }
  let body = match[3].trim(), alias = match[2] || ''
  const reuse = body.match(/^\{\s*\.\.\.([^{}]+)\s*\}$/)
  if (reuse) { alias = reuse[1].trim(); body = '' }
  else if (body.startsWith('{~') && body.endsWith('~}')) body = body.slice(2, -2).trim()
  else if (body.startsWith(':')) body = body.slice(1).trim()
  if (/^\(script of template .+ not found\)$/.test(body)) body = ''
  return { params, body, alias }
}

function sources(raw) {
  const result = []
  const add = (text, kind, label = '') => {
    if (typeof text !== 'string') return
    const start = text.indexOf('custom(')
    if (start < 0) return
    try {
      const rule = custom(text.slice(start))
      if (rule) result.push({ ...rule, kind, label: label || (!kind ? text.slice(0, start).trim().replace(/:\s*$/, '') : '') })
    } catch { /* Malformed unrelated rules cannot provide a template. */ }
  }
  for (const script of array(raw?.rules?.progression_scripts)) add(script, '')
  for (const row of array(raw?.rules?.progression)) add(row, 'progress')
  for (const week of array(raw?.weeks)) for (const day of array(week?.days)) {
    for (const exercise of array(day?.exercises)) for (const rule of array(exercise?.rules)) {
      add(rule?.summary, rule?.kind, exercise?.label || exercise?.name || '')
    }
  }
  return result
}

// Only an explicit alias or a unique matching body can recover a source. An
// unrelated script with the same parameter names is never a fallback.
function resolve(rule, kind, candidates) {
  let body = rule.body, defaults = Object.create(null)
  const usable = candidates.filter(c => c.body && (!c.kind || c.kind === kind))
  if (!body || clipped(body)) {
    const prefix = compact(body.replace(/(?:\.\.\.|…)\s*$/, ''))
    const matches = usable.filter(c => !clipped(c.body) && (
      prefix ? compact(c.body).startsWith(prefix) : rule.alias && (c.alias === rule.alias || c.label === rule.alias)
    ))
    const bodies = new Set(matches.map(c => compact(c.body)))
    if (bodies.size !== 1) fail(body ? 'The rule is truncated and its full source is unavailable or ambiguous.' : 'The reused rule source is missing or ambiguous.')
    body = matches[0].body
    // Different callers of an alias may override its parameters. Only a
    // labeled template, or the matching full raw definition, supplies defaults.
    const donors = matches.filter(c => c.label === rule.alias || !c.kind && compact(c.body) === compact(body))
    for (const donor of donors) for (const [key, value] of Object.entries(donor.params)) {
      if (rule.params[key]) continue
      if (defaults[key] && amount(defaults[key]) !== amount(value)) fail('The rule has conflicting inherited parameters.')
      defaults[key] = value
    }
  }
  const equivalents = usable.filter(c => compact(c.body) === compact(body) && (
    rule.alias ? c.label === rule.alias : !c.kind && Object.entries(rule.params).every(([key, value]) => c.params[key] && amount(c.params[key]) === amount(value))
  ))
  for (const donor of equivalents) for (const [key, value] of Object.entries(donor.params)) {
    if (rule.params[key]) continue
    if (defaults[key] && amount(defaults[key]) !== amount(value)) fail('The rule has conflicting inherited parameters.')
    defaults[key] = value
  }
  return { body, params: { ...defaults, ...rule.params } }
}

function tokenize(source) {
  if (source.length > 20000) fail('The rule is too large to translate safely.')
  const tokens = [], re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:\d+(?:\.\d+)?|\.\d+)(?:lb|kg|%)?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|>=|<=|==|!=|&&|\|\||\+=|-=|\*=|\/=|[{}()[\],:;?+\-*/%!<>=]/gy
  let pos = 0
  while (pos < source.length) {
    re.lastIndex = pos
    const match = re.exec(source)
    if (!match) fail('The rule contains unsupported syntax.')
    pos = re.lastIndex
    if (!/^\s|^\/\//.test(match[0]) && !match[0].startsWith('/*')) tokens.push(match[0])
    if (tokens.length > 4000) fail('The rule is too large to translate safely.')
  }
  return tokens
}

const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '>=': 4, '<': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }
function parse(source) {
  const tokens = tokenize(source)
  let i = 0, depth = 0
  const take = expected => {
    const token = tokens[i++]
    if (!token || expected && token !== expected) fail('The rule could not be read in full.')
    return token
  }
  function expression(min = 0) {
    if (++depth > 60) fail('The rule is nested too deeply to translate safely.')
    let left, token = take()
    if (token === '(') { left = expression(); take(')') }
    else if (['!', '-'].includes(token)) left = { type: 'unary', op: token, value: expression(7) }
    else if (/^(?:\d|\.\d)/.test(token)) {
      const n = token.match(/^([\d.]+)(lb|kg|%)?$/)
      left = number(Number(n[1]), n[2] || '')
    } else if (/^[A-Za-z_]\w*(?:\.\w+)?$/.test(token)) {
      left = { type: 'ref', name: token.replace(/^state\./, ''), state: token.startsWith('state.') }
      if (tokens[i] === '(') {
        take('('); const args = []
        if (tokens[i] !== ')') do { args.push(expression()) } while (tokens[i] === ',' && take(','))
        take(')'); left = { type: 'call', name: token, args }
      }
      if (tokens[i] === '[') {
        take('['); const indexes = []
        do { indexes.push(tokens[i] === '*' ? (take('*'), { type: 'all' }) : expression()) } while (tokens[i] === ':' && take(':'))
        take(']'); left = { type: 'index', value: left, indexes }
      }
    } else fail('The rule contains an unsupported expression.')
    while (precedence[tokens[i]] >= min) {
      const op = take(), right = expression(precedence[op] + 1)
      left = { type: 'binary', op, left, right }
    }
    if (min === 0 && tokens[i] === '?') {
      take('?'); const yes = expression(); take(':'); const no = expression()
      left = { type: 'choice', condition: left, yes, no }
    }
    depth--
    return left
  }
  function block() {
    take('{'); const statements = []
    while (tokens[i] !== '}') statements.push(statement())
    take('}'); return statements
  }
  function statement() {
    if (++depth > 60) fail('The rule is nested too deeply to translate safely.')
    let result
    if (tokens[i] === 'if') {
      take('if'); take('('); const condition = expression(); take(')'); const yes = block()
      let no = []
      if (tokens[i] === 'else') { take('else'); no = tokens[i] === 'if' ? [statement()] : block() }
      result = { type: 'if', condition, yes, no }
    } else if (tokens[i] === 'for') {
      take('for'); take('('); const variable = take(); take('in'); const over = expression(); take(')')
      if (!/^var\.\w+$/.test(variable)) fail('The rule contains an unsupported loop.')
      result = { type: 'for', variable, over, body: block() }
    } else {
      const target = expression()
      if (['=', '+=', '-=', '*=', '/='].includes(tokens[i])) {
        const op = take(); const value = expression()
        if (!['ref', 'index'].includes(target.type)) fail('The rule contains an unsupported assignment.')
        result = { type: 'assign', target, op, value }
      } else if (target.type === 'call') result = target
      else fail('The rule contains an unsupported statement.')
    }
    if (tokens[i] === ';') take(';')
    depth--
    return result
  }
  const ast = []
  while (i < tokens.length) ast.push(statement())
  if (!ast.length) fail('The rule source is empty.')
  return ast
}

const labels = {
  __proto__: null,
  weights: 'load', completedWeights: 'completed load', reps: 'rep target', minReps: 'minimum rep target',
  completedReps: 'completed reps', rm1: '1RM reference', week: 'week', dayInWeek: 'day of the week',
  numberOfSets: 'number of sets', completedNumberOfSets: 'number of completed sets', programNumberOfSets: 'prescribed number of sets',
  setIndex: 'current set number', ns: 'last set', setVariationIndex: 'stage', exerciseVariationIndex: 'exercise variation',
  setTime: 'hold duration in seconds', completedSetTime: 'completed hold duration in seconds', RPE: 'RPE',
  stage1weight: 'saved stage 1 load', mainJump: 'saved wave load increase', lastReps: 'previous recorded total reps',
  failures: 'failure count', stalls: 'stall count', changeExercise: 'exercise replacement decision',
  'var.r': 'follow-up rep target', 'var.extra': 'extra reps', 'var.stop': 'record of whether a set was adjusted', 'var.progressed': 'record of whether a load increased',
}
const parameterLabels = {
  __proto__: null,
  increase: 'load increase', increment: 'load increase', stage3increase: 'stage restart increase', addWeight: 'added load',
  triggerWeek: 'progression week', minReps: 'lower rep target', maxReps: 'upper rep target',
  min: 'lower rep target', max: 'upper rep target', topVar: 'final exercise variation', holdRung: 'hold exercise variation',
  holdTarget: 'hold duration target', initialReps: 'initial rep target', diff: 'rep target reduction',
  powerDay: 'power day', speedDay: 'speed day', upper: 'upper total rep threshold', lower: 'lower total rep threshold',
  upper1: 'first set rep threshold', upper2: 'second set rep threshold', inc: 'load increase',
  inc1: 'first set load increase', inc2: 'second set load increase', minTarget: 'lower rep target', maxTarget: 'upper rep target',
}
const ref = (node, name) => node?.type === 'ref' && node.name === name
const literal = (node, value) => node?.type === 'number' && !node.unit && (value == null || node.value === value)
const rootName = node => node.type === 'index' ? rootName(node.value) : node.name
function assigned(ast, set = new Set()) {
  for (const node of ast) {
    if (node.type === 'assign') set.add(rootName(node.target))
    if (node.type === 'if') { assigned(node.yes, set); assigned(node.no, set) }
    if (node.type === 'for') assigned(node.body, set)
  }
  return set
}

function renderer(exercise, params, mutable, reasons, alias) {
  const loops = new Set()
  const missing = name => {
    const label = parameterLabels[name]
    if (!label) fail('The rule refers to a value whose meaning is unsupported.')
    reasons.add(`The ${label} is missing from the imported rule.`)
    return `the unspecified ${label}`
  }
  function constant(node) {
    if (node.type === 'ref' && params[node.name] && !mutable.has(node.name)) return params[node.name]
    if (node.type === 'binary' && ['+', '-', '*', '/'].includes(node.op)) {
      const left = constant(node.left), right = constant(node.right)
      if (left.type === 'number' && right.type === 'number') {
        let value, unit
        if (['+', '-'].includes(node.op) && left.unit === right.unit) { value = node.op === '+' ? left.value + right.value : left.value - right.value; unit = left.unit }
        if (node.op === '*' && !(left.unit && right.unit)) { value = left.value * right.value; unit = left.unit || right.unit }
        if (node.op === '/' && !right.unit && right.value !== 0) { value = left.value / right.value; unit = left.unit }
        if (Number.isFinite(value)) return number(Number(value.toFixed(8)), unit)
      }
    }
    return node
  }
  // A numbered set must exist among the exercise's working sets; otherwise the
  // text would read fine but describe a rule that can never apply.
  function checkedSet(n) {
    const rows = array(exercise?.sets).filter(row => row && row.kind !== 'warmup')
    let max = 0
    for (const row of rows) {
      const count = Number(Array.isArray(row.count) ? Math.min(...row.count) : row.count ?? 1)
      max += Number.isInteger(count) && count > 0 ? count : 0
    }
    if (!Number.isInteger(n) || n < 1 || (rows.length && n > max)) fail('The rule refers to a set that does not exist in this exercise.')
    return n
  }
  function setName(index) {
    if (ref(index, 'ns') || ref(index, 'numberOfSets')) return array(exercise?.sets).at(-1)?.amrap || array(exercise?.sets).at(-1)?.kind === 'amrap' ? 'the last AMRAP set' : 'the last set'
    if (index.type === 'unary' && literal(index.value)) fail('The rule refers to a set that does not exist in this exercise.')
    if (loops.has(index.name)) return 'this set'
    if (ref(index, 'setIndex')) return 'the current set'
    if (literal(index)) return `set ${checkedSet(index.value)}`
    return `the set numbered ${expr(index)}`
  }
  function expr(original) {
    const node = constant(original)
    if (node.type === 'number') return amount(node)
    if (node.type === 'ref') {
      if (loops.has(node.name)) return 'this set number'
      if (params[node.name] && !mutable.has(node.name)) return amount(params[node.name])
      if (parameterLabels[node.name] && !(mutable.has(node.name) && labels[node.name]) && !(node.name === 'minReps' && !node.state && !alias)) return missing(node.name)
      if (labels[node.name]) return `the ${labels[node.name]}`
      fail('The rule refers to a value whose meaning is unsupported.')
    }
    if (node.type === 'index') {
      if (!ref(node.value, rootName(node.value)) || !['weights', 'completedWeights', 'reps', 'minReps', 'completedReps', 'setTime', 'completedSetTime', 'RPE'].includes(node.value.name)) fail('The rule contains an unsupported set reference.')
      if (node.indexes.length === 1) return `${expr(node.value)} for ${setName(node.indexes[0])}`
      return `${expr(node.value)} for ${selector(node.indexes)}`
    }
    if (node.type === 'unary') return node.op === '!' ? `it is not true that (${expr(node.value)})` : `negative (${expr(node.value)})`
    if (node.type === 'choice') return `${expr(node.yes)} when ${expr(node.condition)}; otherwise ${expr(node.no)}`
    if (node.type === 'call') {
      const args = node.args.map(expr)
      if (['sum', 'min', 'max'].includes(node.name) && args.length === 1) return `the ${ { sum: 'total', min: 'lowest', max: 'highest' }[node.name]} of ${args[0]}`
      if (['min', 'max'].includes(node.name) && args.length > 1) return `the ${node.name === 'min' ? 'smaller' : 'larger'} of (${args.join(' and ')})`
      if (['floor', 'round', 'roundWeight'].includes(node.name) && args.length === 1) return `${args[0]}, ${node.name === 'floor' ? 'rounded down' : node.name === 'roundWeight' ? 'rounded to an available load' : 'rounded to the nearest whole number'}`
      if (node.name === 'rpeMultiplier' && args.length === 2) return `the 1RM fraction for ${args[0]} reps at RPE ${args[1]}`
      fail('The rule contains an unsupported calculation.')
    }
    if (node.type === 'binary') {
      const left = constant(node.left), right = constant(node.right), op = node.op
      if (['>=', '=='].includes(op) && ref(left, 'completedReps') && ['reps', 'minReps'].includes(right.name)) return op === '>=' ? `every set meets its ${right.name === 'minReps' ? 'minimum ' : ''}rep target` : 'every set exactly meets its rep target'
      if (ref(left, 'var.stop') && op === '==' && literal(right, 0)) return 'no set has been adjusted yet'
      if (ref(left, 'var.progressed') && op === '>' && literal(right, 0)) return 'a load increased'
      if (op === '>=' && ref(left, 'completedSetTime') && ref(right, 'setTime')) return 'every hold meets its duration target'
      if (op === '==' && ref(left, 'setIndex') && literal(right, 0)) return 'the session has not started'
      if (op === '==' && ref(left, 'setIndex') && literal(right)) return `set ${right.value} is finished`
      if (left.type === 'binary' && left.op === '%' && literal(left.right) && literal(right) && ['==', '!='].includes(op)) {
        if (ref(left.left, 'week')) {
          if (right.value === 0) return `${op === '!=' ? 'it is not ' : 'it is '}the last week of each ${left.right.value}-week cycle`
          if (left.right.value === 2 && right.value === 1) return `${op === '!=' ? 'it is not an' : 'it is an'} odd-numbered week`
          return `the week falls ${op === '!=' ? 'outside' : 'on'} position ${right.value} of each ${left.right.value}-week cycle`
        }
      }
      if (['&&', '||'].includes(op)) return `(${expr(left)}) ${op === '&&' ? 'and' : 'or'} (${expr(right)})`
      const words = { '==': 'equals', '!=': 'does not equal', '>': 'is more than', '>=': 'is at least', '<': 'is less than', '<=': 'is at most', '+': 'plus', '-': 'minus', '*': 'times', '/': 'divided by', '%': 'modulo' }
      if (op === '*' && literal(right) && right.value > 0 && right.value < 1) return `${Number((right.value * 100).toFixed(8))}% of (${expr(left)})`
      if (['*', '/'].includes(op)) return `(${expr(left)}) ${words[op]} (${expr(right)})`
      if (op === '%') return `the remainder after dividing (${expr(left)}) by (${expr(right)})`
      if (['+', '-'].includes(op)) return `${left.type === 'binary' ? `(${expr(left)})` : expr(left)} ${words[op]} ${['binary', 'choice'].includes(right.type) ? `(${expr(right)})` : expr(right)}`
      return `${expr(left)} ${words[op]} ${right.type === 'choice' ? `(${expr(right)})` : expr(right)}`
    }
    fail('The rule contains an unsupported expression.')
  }
  function selector(indexes) {
    if (indexes.length !== 4) fail('The rule contains an unsupported set selection.')
    const parts = indexes.map((index, i) => index.type === 'all' ? '' : `${['week', 'day', 'stage', 'set'][i]} ${i === 3 && literal(index) ? checkedSet(index.value) : expr(index)}`).filter(Boolean)
    return parts.length ? parts.join(', ') : 'all weeks, days, stages and sets'
  }
  function target(node) {
    if (node.type === 'index') return `${expr(node.value)} for ${node.indexes.length === 1 ? setName(node.indexes[0]) : selector(node.indexes)}`
    if (ref(node, 'weights')) return 'the load for all sets'
    if (ref(node, 'reps')) return 'the rep target for all sets'
    return expr(node)
  }
  function action(node) {
    if (node.type === 'call') {
      if (node.name !== 'sets' || node.args.length !== 9) fail('The rule contains an unsupported action.')
      const [first, last, low, high, amrap, load, rest, rpe, logRpe] = node.args
      if (!literal(amrap) || ![0, 1].includes(amrap.value) || !literal(logRpe) || ![0, 1].includes(logRpe.value)) fail('The rule contains an unsupported set configuration.')
      const reps = compact(JSON.stringify(low)) === compact(JSON.stringify(high)) ? expr(low) : `${expr(low)} to ${expr(high)}`
      return `Configure sets ${expr(first)} through ${expr(last)} for ${reps} reps${amrap.value ? ' with as many reps as possible' : ''}, use ${expr(load)}, and rest ${expr(rest)} seconds${literal(rpe, 0) ? '' : ` at RPE ${expr(rpe)}`}${logRpe.value ? '; record RPE' : ''}. Perform only the prescribed number of sets.`
    }
    if (ref(node.target, 'descriptionIndex')) return '' // Display metadata, not a training action.
    if (ref(node.target, 'var.stop') && node.op === '=' && literal(node.value) && [0, 1].includes(node.value.value)) return node.value.value ? 'Record that one set has been adjusted.' : 'Start with no sets adjusted yet.'
    if (ref(node.target, 'var.progressed') && node.op === '=' && literal(node.value) && [0, 1].includes(node.value.value)) return node.value.value ? 'Record that a load increased.' : 'Start with no load increase recorded yet.'
    const name = rootName(node.target), value = constant(node.value), destination = target(node.target)
    if (name === 'changeExercise' && node.op === '=' && literal(value) && [0, 1].includes(value.value)) return value.value ? 'Replace this exercise.' : 'Keep this exercise unless the later replacement condition is met.'
    if (name === 'setVariationIndex' || name === 'exerciseVariationIndex') {
      const noun = name === 'setVariationIndex' ? 'stage' : 'exercise variation'
      if (node.op === '=' && literal(value)) return `Switch to ${noun} ${value.value}.`
      if (node.op === '+=' && literal(value, 1)) return `Move to the next ${noun}.`
      if (node.op === '-=' && literal(value, 1)) return `Move to the previous ${noun}.`
    }
    if (node.op === '=') return `Set ${destination} to ${expr(value)}.`
    if (node.op === '+=') return `Add ${expr(value)} to ${destination}.`
    if (node.op === '-=') return `Subtract ${expr(value)} from ${destination}.`
    if (node.op === '*=' && literal(value) && value.value > 0 && value.value < 1) return `Reduce ${destination} by ${Number(((1 - value.value) * 100).toFixed(8))}%.`
    if (node.op === '*=' || node.op === '/=') return `${node.op === '*=' ? 'Multiply' : 'Divide'} ${destination} ${node.op === '*=' ? 'by' : 'by'} ${expr(value)}.`
    fail('The rule contains an unsupported action.')
  }
  function render(nodes, indent = '') {
    const result = []
    for (const node of nodes) {
      if (node.type === 'if') {
        const yes = render(node.yes, `${indent}  `), no = render(node.no, `${indent}  `)
        if (!yes.length && !no.length) continue
        if (!yes.length) { result.push(`${indent}If it is not true that (${expr(node.condition)}):`, ...no); continue }
        result.push(`${indent}If ${expr(node.condition)}:`, ...yes)
        if (no.length) result.push(`${indent}Otherwise:`, ...no)
      } else if (node.type === 'for') {
        if (node.over.type !== 'ref' || !['reps', 'completedReps', 'weights', 'completedWeights'].includes(node.over.name)) fail('The rule contains an unsupported loop.')
        const alreadyBound = loops.has(node.variable)
        loops.add(node.variable); const body = render(node.body, `${indent}  `)
        if (!alreadyBound) loops.delete(node.variable)
        result.push(`${indent}For each set, in order:`, ...body)
      } else {
        const text = action(node)
        if (text) result.push(`${indent}${text}`)
      }
    }
    return result
  }
  return render
}

// Prose is preserved only when it is prose. Code-like notes never leak into the
// athlete instructions and never become a substitute for an unreadable rule.
function prose(text) {
  return typeof text === 'string' && text.trim() && !clipped(text) && !/[{}]|=>|<\/?script\b|javascript:|\b(?:const|let|throw)\s|\b(?:[A-Za-z_$][\w.$]*\(|[A-Za-z_$]\w*(?:\.\w+)+\s*\(|(?:if|for|eval|Function|import)\s*\(|(?:state|var|globalThis|process|window|document)\.|(?:weights|completedReps|rm1)\s*[=\[])|[A-Za-z_$][\w.$]*\s*(?:\+=|-=|\*=)/.test(text) ? text.trim() : ''
}
function simple(summary) {
  let match = summary.match(/^linear: add (\d+(?:\.\d+)?)(lb|kg|%) after (\d+) successful session\(s\)(?:; subtract (\d+(?:\.\d+)?)(lb|kg|%) after (\d+) failed session\(s\))?$/i)
  if (match) return `Add ${match[1]} ${match[2]} after ${match[3]} successful session${match[3] === '1' ? '' : 's'} (meet every prescribed rep target).${match[4] ? ` Reduce the load by ${match[4]} ${match[5]} after ${match[6]} failed session${match[6] === '1' ? '' : 's'}.` : ''}`
  match = summary.match(/^double progression: reps (\d+)-(\d+); at the top add (\d+(?:\.\d+)?)(lb|kg|%) and reset reps to (\d+)$/i)
  if (match) return `Work within ${match[1]}–${match[2]} reps. When every set reaches ${match[2]} reps, add ${match[3]} ${match[4]} and reset the rep target to ${match[5]}.`
  match = summary.match(/^reps-sum: add (\d+(?:\.\d+)?)(lb|kg|%) when total reps (>|>=) (\d+)$/i)
  if (match) return `Add ${match[1]} ${match[2]} when total completed reps across all sets ${match[3] === '>' ? 'exceed' : 'reach at least'} ${match[4]}.`
  if (/^progress: none \(progression disabled\)$/i.test(summary)) return 'Progression is disabled; keep the prescribed load.'
  if (/^(?:linear|double progression|reps-sum|progress):/i.test(summary)) fail('The progression summary could not be read in full.')
  return prose(summary)
}

function stageSets(rows) {
  if (!array(rows).length) fail('A stage is missing its set prescription.')
  return rows.map(row => {
    if (!row || !(Number.isFinite(Number(row.count)) && Number(row.count) > 0) || !(Number.isFinite(Number(row.reps)) && Number(row.reps) > 0)) fail('A stage has an unsupported set prescription.')
    const count = Number(row.count), reps = Number(row.reps)
    const extra = []
    if (row.pct != null) {
      if (!Number.isFinite(Number(row.pct))) fail('A stage has an unsupported load prescription.')
      extra.push(`${row.pct}% of the 1RM reference`)
    } else if (row.weight != null) {
      if (!Number.isFinite(Number(row.weight))) fail('A stage has an unsupported load prescription.')
      extra.push(`${row.weight} ${row.unit || 'units of load'}`)
    }
    if (row.rest) {
      if (!/^\d+(?:\.\d+)?s?$/.test(row.rest)) fail('A stage has an unsupported rest prescription.')
      extra.push(`${parseFloat(row.rest)} seconds rest`)
    }
    for (const key of ['rpe', 'rir']) if (row[key] != null) {
      if (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0 || key === 'rpe' && Number(row[key]) > 10) fail('A stage has an unsupported effort prescription.')
      extra.push(key === 'rpe' ? `RPE ${row[key]}` : `${row[key]} reps in reserve`)
    }
    if (row.note) { const note = prose(row.note); if (!note) fail('A stage has an unreadable note.'); extra.push(note) }
    return `${count} set${count === 1 ? '' : 's'} of ${reps}${row.amrap || row.kind === 'amrap' ? '+ reps (as many as possible)' : ' reps'}${extra.length ? `, ${extra.join(', ')}` : ''}`
  }).join('; ')
}

/** Translate authored training rules, without executing them or mutating inputs.
 * complete describes translation coverage, not automatic progression support.
 * An exercise with no authored rule requires no translation and is complete,
 * unless its source explicitly says parsing failed or a rule is missing.
 */
export function programmeRuleText(exercise = {}, rawProgram = {}) {
  const reasons = new Set(), parts = [], progressionParts = [], rules = array(exercise?.rules)
  const addProse = value => {
    for (const text of Array.isArray(value) ? value : [value]) {
      if (text == null || text === '') continue
      const translated = prose(text)
      if (translated) parts.push(translated)
      else reasons.add('An authored instruction or note could not be translated.')
    }
  }
  addProse(exercise?.instructions); addProse(exercise?.notes)
  if (exercise?.parsed === false) reasons.add('The source marks this exercise as not fully parsed.')
  if (exercise?.rules != null && !Array.isArray(exercise.rules)) reasons.add('The exercise rules are not a readable list.')
  let candidates
  const prepared = []
  for (const rule of rules) {
    try {
      if (!rule || typeof rule !== 'object') fail('An exercise rule is unreadable.')
      if (rule.kind === 'set_variation') {
        if (!Number.isInteger(Number(rule.index)) || Number(rule.index) < 1) fail('A stage number is missing or invalid.')
        parts.push(`Stage ${rule.index}: ${stageSets(array(rule.sets).map(row => ({ ...row, unit: rawProgram?.unit || row.unit })))}.`)
      } else if (rule.kind === 'exercise_variation') {
        if (!array(rule.alternatives).length || rule.alternatives.some(name => !prose(name))) fail('Exercise variations are missing or unreadable.')
        if (exercise.name && !prose(exercise.name)) fail('Exercise variations are missing or unreadable.')
        parts.push(`Exercise variations in order: ${[exercise.name, ...rule.alternatives].filter(Boolean).join(' → ')}.`)
      } else if (['progress', 'update'].includes(rule.kind)) {
        if (typeof rule.summary !== 'string' || !rule.summary.trim()) fail('An authored progression or update rule is missing.')
        const parsed = custom(rule.summary)
        if (parsed) {
          candidates ??= sources(rawProgram)
          const resolved = resolve(parsed, rule.kind, candidates)
          prepared.push({ ...resolved, alias: parsed.alias, kind: rule.kind, ast: parse(resolved.body) })
        } else {
          const text = simple(rule.summary)
          if (!text) fail('An authored progression or update rule could not be translated.')
          parts.push(text)
          if (rule.kind === 'progress') progressionParts.push(text)
        }
      } else fail('An exercise rule has an unsupported type.')
    } catch (error) { reasons.add(error.message) }
  }
  const mutable = new Set()
  prepared.forEach(rule => assigned(rule.ast, mutable))
  // Reuse progression parameters in same-exercise updates only if the values
  // agree. Inherited unknown defaults remain unknown, rather than invented.
  const shared = Object.create(null), conflicts = new Set()
  for (const rule of prepared) for (const [key, value] of Object.entries(rule.params)) {
    if (shared[key] && amount(shared[key]) !== amount(value)) conflicts.add(key)
    shared[key] = value
  }
  for (const key of conflicts) delete shared[key]
  for (const rule of prepared) {
    try {
      const localReasons = new Set()
      const render = renderer(exercise, Object.assign(Object.create(null), shared, rule.params), mutable, localReasons, rule.alias)
      const lines = render(rule.ast)
      if (lines.length) {
        const text = `${rule.kind === 'update' ? 'During the session' : 'After the session'}:\n${lines.join('\n')}`
        parts.push(text)
        if (rule.kind === 'progress') progressionParts.push(text)
      }
      localReasons.forEach(reason => reasons.add(reason))
    } catch (error) { reasons.add(error.message) }
  }
  const instructions = [...new Set(parts)].join('\n\n')
  const progressionInstructions = reasons.size ? '' : [...new Set(progressionParts)].join('\n\n')
  return { instructions, ...(progressionInstructions ? {progressionInstructions} : {}), complete: reasons.size === 0, reasons: [...reasons] }
}
