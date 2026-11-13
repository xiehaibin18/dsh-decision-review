/** @jsxRuntime classic */
import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import * as React from 'react'
import { cn } from './utils.js'

export function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive
      {...props}
      data-slot="radio-group"
      className={cn('decision-review-radio-group dr:w-full', className)}
    />
  )
}

export function RadioGroupItem<Value>({ children, className, ...props }: RadioPrimitive.Root.Props<Value>) {
  return (
    <RadioPrimitive.Root
      {...props}
      render={<button type="button" />}
      nativeButton
      data-slot="radio-group-item"
      className={cn(
        'decision-review-control decision-review-radio-item dr:flex dr:min-w-0 dr:items-center dr:gap-[8px] dr:rounded-[var(--decision-review-radius)] dr:px-[10px] dr:py-[6px] dr:text-start dr:enabled:cursor-pointer',
        className,
      )}
    >
      <span className="decision-review-radio-mark" aria-hidden="true">
        <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="decision-review-radio-indicator" />
      </span>
      <span>{children}</span>
    </RadioPrimitive.Root>
  )
}
