import { describe, expect, test } from 'bun:test'
import { assertScopedStylesheet } from '../scripts/check-stylesheet.mjs'

describe('generated plugin stylesheet scope', () => {
  test('accepts escaped Tailwind classes and scoped selector lists in grouping rules', () => {
    expect(() =>
      assertScopedStylesheet(String.raw`
        @layer decision-review-utilities {
          .dr\:w-\[6px\], .dr\:block { width: 6px; }
          .dr\:hover\:block { &:hover { @media (hover: hover) { display: block; } } }
        }
        .decision-review-panel :is(input, textarea), .decision-review-control[data-value="a,b"] { color: red; }
      `),
    ).not.toThrow()
  })

  test.each([
    'body { color: rgb(1,2,3); }',
    '.dr\\:block, body { color: rgb(1,2,3); }',
    '@media (hover: hover) { .dr\\:block { display: block; } body { color: red; } }',
    '.dr\\:block { &:hover, body { color: red; } }',
    '.decision-review-panel + body { color: red; }',
    '@import "outside.css";',
    '@property --external { syntax: "*"; }',
  ])('rejects CSS that can leave the plugin scope: %s', (css) => {
    expect(() => assertScopedStylesheet('.dr\\:block { display: block; } ' + css)).toThrow()
  })
})
