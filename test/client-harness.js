import { expect, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

export const CLIENT_ORIGIN = 'https://dsh.example.test'
export const CONFIG_SLOT = 'plugins.row.config'
export const STATS_SLOT = 'conversation.composer.dock'

const bundle = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')

export function createClient(fetch) {
  const { window } = new JSDOM('<div id="root"></div>', {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: CLIENT_ORIGIN,
  })
  const container = window.document.getElementById('root')
  const globals = { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const originalDescriptors = Object.keys(globals).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ])
  Object.assign(globalThis, globals)

  const sharedModules = { react: React, 'react/jsx-runtime': jsxRuntime }
  const slots = new Map()
  let messages
  let language = 'en'
  let root
  let disposeLocale
  const unregisterLocale = mock()

  window.fetch = fetch
  // The host route adapter constructs Bun Requests from the browser-side fetch options.
  window.AbortController = globalThis.AbortController
  // jsdom implements intervals with its own rescheduling. Use Bun's clock for the pill instead.
  window.setInterval = (...args) => globalThis.setInterval(...args)
  window.clearInterval = (id) => globalThis.clearInterval(id)
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      expect(id).toBe('@local/decision-review')
      const client = factory((name) => {
        expect(Object.hasOwn(sharedModules, name)).toBe(true)
        return sharedModules[name]
      })
      expect([...client.inject]).toEqual(['slots', 'locale'])
      disposeLocale = client.apply({
        locale: {
          register(namespace, dictionaries) {
            expect(namespace).toBe('decision-review')
            messages = dictionaries
            return unregisterLocale
          },
          resolveText: (text) => (typeof text === 'string' ? text : (text[language] ?? text.en)),
        },
        slots: {
          inject: (_slot, setup) => setup(),
          register(meta, component) {
            expect(meta.locale).toBe('decision-review')
            slots.set(meta.name, component)
          },
        },
      })
    },
  }

  function translate(key, params = {}) {
    if (!Object.hasOwn(messages[language], key)) throw new Error(`Missing message: ${language}/${key}`)
    return messages[language][key].replace(/\{(\w+)\}/g, (_, name) => {
      if (!Object.hasOwn(params, name)) throw new Error(`Missing parameter: ${key}/${name}`)
      return String(params[name])
    })
  }

  async function unmount() {
    if (!root) return
    await act(async () => root.unmount())
    root = undefined
  }

  return {
    window,
    container,
    unregisterLocale,
    async load() {
      // React DOM probes browser support when it is first evaluated.
      sharedModules['react-dom'] = await import('react-dom')
      window.eval(bundle)
    },
    get messages() {
      return messages
    },
    set language(value) {
      language = value
    },
    translate,
    async render(slot, props) {
      const component = slots.get(slot)
      expect(component, `Missing registered slot: ${slot}`).toBeFunction()
      // React DOM checks for a browser when initializing its input event handling.
      const { createRoot } = await import('react-dom/client')
      root ??= createRoot(container)
      await act(async () => root.render(React.createElement(component, { ...props, t: translate })))
    },
    unmount,
    async dispose() {
      try {
        await unmount()
      } finally {
        try {
          disposeLocale?.()
          window.close()
        } finally {
          for (const [name, descriptor] of originalDescriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else delete globalThis[name]
          }
        }
      }
    },
    button(label) {
      return [...container.querySelectorAll('button')].find(
        (node) => (node.getAttribute('aria-label') ?? node.textContent.replace(/^\+ /, '')) === label,
      )
    },
    async choose(control, label) {
      await act(async () => control.click())
      const option = [...container.querySelectorAll('[role="option"]')].find((node) => node.textContent === label)
      expect(option, `Missing option: ${label}`).toBeDefined()
      await act(async () => {
        option.click()
        // jsdom runs Base UI's focus and layout work on the next visual frame.
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
      })
      expect(control.getAttribute('aria-expanded')).toBe('false')
    },
    async change(control, value) {
      // Call the native setter so React's value tracker observes the DOM event.
      const { set } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
      await act(async () => {
        set.call(control, value)
        control.dispatchEvent(new window.Event('input', { bubbles: true }))
      })
    },
  }
}
