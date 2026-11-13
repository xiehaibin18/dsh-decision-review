// Deliberately limited to the CSS we ship: scoped selector lists, grouping
// rules, and compound & modifiers emitted by Tailwind. Reject unfamiliar
// nesting or selector shapes rather than guessing what they would match.
export function assertScopedStylesheet(css) {
  if (/:root|:host|--tw-/.test(css)) throw new Error('Unexpected global theme or Tailwind property')
  const blocks = ['rules']
  let start = 0
  let selectorList = []

  for (const index of topLevelIndices(css)) {
    const char = css[index]
    if (char === '/' && css[index + 1] === '*') {
      if (!css.slice(start, index).trim()) start = css.indexOf('*/', index + 2) + 2
      continue
    }
    if (char === ',') {
      selectorList.push(css.slice(start, index).trim())
      start = index + 1
      continue
    }

    if (char !== '{' && char !== '}' && char !== ';') continue
    const tokens = [...selectorList, css.slice(start, index).trim()]
    const header = tokens.join(',')
    selectorList = []
    start = index + 1
    const block = blocks.at(-1)
    if (char === '{') {
      if (/^@(?:media|supports)\s/.test(header) || /^@layer decision-review-[\w-]+$/.test(header)) {
        blocks.push(block)
        continue
      }
      if (header.startsWith('@')) throw new Error(`Unexpected CSS rule: ${header}`)
      for (const selector of tokens) assertScopedSelector(selector, block === 'declarations')
      blocks.push('declarations')
    } else {
      if (header && (block !== 'declarations' || header.startsWith('@'))) {
        throw new Error(`Unexpected CSS statement: ${header}`)
      }
      if (char === '}') blocks.pop()
    }
  }
  if (blocks.length !== 1 || css.slice(start).trim() || selectorList.length) {
    throw new Error('Incomplete scoped stylesheet')
  }
}

// Ignore lexical contents when looking for rule boundaries or top-level
// combinators. Keep offsets into the original text for errors and prefix checks.
function* topLevelIndices(css) {
  const groups = []
  let quote
  for (let index = 0; index < css.length; index++) {
    const char = css[index]
    if (char === '\\') {
      index++
    } else if (quote) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      if (end === -1) throw new Error('Unclosed CSS comment')
      // The caller skips leading comments at rule boundaries, but retains them
      // in selectors so an error can name the exact source.
      if (!groups.length) yield index
      index = end + 1
    } else if (char === '(' || char === '[') {
      groups.push(char === '(' ? ')' : ']')
    } else if (char === ')' || char === ']') {
      if (groups.pop() !== char) throw new Error('Incomplete scoped stylesheet')
    } else if (!groups.length) {
      yield index
    }
  }
  if (quote || groups.length) throw new Error('Incomplete scoped stylesheet')
}

function assertScopedSelector(selector, nested) {
  const name = selector.match(/^\.(?:dr\\:|decision-review-)(?:[\w-]|\\[^\r\n])+/)?.[0]
  if (!name && !(nested && /^&(?=$|[.:[\s>])/.test(selector))) {
    throw new Error(`Unscoped CSS selector: ${selector}`)
  }
  // A sibling of a scoped element is not necessarily part of the plugin.
  for (const index of topLevelIndices(selector)) {
    if (selector[index] === '+' || selector[index] === '~' || selector.startsWith('||', index)) {
      throw new Error(`CSS selector escapes plugin scope: ${selector}`)
    }
  }
}
