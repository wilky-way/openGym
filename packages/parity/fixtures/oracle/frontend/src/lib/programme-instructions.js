import { ruleInstructions } from './programme-import.js'
import { effortOf } from './history.js'

/** Authored prose stays opaque; generated rules carry their own numeric provenance. */
export function programmeInstructions(S, cfg) {
  if (!cfg?.generatedRules) return cfg?.instructions || ''
  return [ruleInstructions({sets: cfg.generatedRules}, effortOf(S)), cfg.authoredInstructions]
    .filter(Boolean).join('\n\n')
}
