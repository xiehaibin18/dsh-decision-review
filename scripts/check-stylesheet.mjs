// Deliberately limited to the CSS we ship: scoped selector lists, grouping
// rules, and compound & modifiers emitted by Tailwind. Reject unfamiliar
// nesting or selector shapes rather than guessing what they would match.
export function assertScopedStylesheet(css) {
  if (/:root|:host|--tw-/.test(css)) throw new Error('Unexpected global theme or Tailwind property')
  const blocks = ['rules']
  let start = 0
  let parentheses = 0
  let brackets = 0
  let quote
  let selectorList = []

  for (let index = 0; index < css.length; index++) {
    const char = css[index]
    if (char === '\\') {
      index++
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      if (end === -1) throw new Error('Unclosed CSS comment')
      if (!css.slice(start, index).trim()) start = end + 2
      index = end + 1
      continue
    }
    if (char === '(') parentheses++
    if (char === ')') parentheses--
    if (char === '[') brackets++
    if (char === ']') brackets--
    if (parentheses || brackets) continue
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
  if (blocks.length !== 1 || css.slice(start).trim() || selectorList.length || quote || parentheses || brackets) {
    throw new Error('Incomplete scoped stylesheet')
  }
}

function assertScopedSelector(selector, nested) {
  const name = selector.match(/^\.(?:dr\\:|decision-review-)(?:[\w-]|\\[^\r\n])+/)?.[0]
  if (!name && !(nested && /^&(?=$|[.:[\s>])/.test(selector))) {
    throw new Error(`Unscoped CSS selector: ${selector}`)
  }
  // Strip functions, attributes and escapes before checking combinators. A
  // sibling of a scoped element is not necessarily part of the plugin.
  const outside = selector.replace(/\\.|"[^"]*"|'[^']*'|\[[^\]]*\]|\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
  if (/[+~]|\|\|/.test(outside)) throw new Error(`CSS selector escapes plugin scope: ${selector}`)
}
