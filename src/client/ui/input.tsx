/** @jsxRuntime classic */
import { Input as InputPrimitive } from '@base-ui/react/input'
import * as React from 'react'
import { cn } from './utils.js'

export function Input({ className, type, ...props }: React.ComponentPropsWithoutRef<'input'>) {
  return (
    <InputPrimitive
      {...props}
      type={type}
      data-slot="input"
      className={cn(
        'decision-review-control decision-review-input dr:block dr:min-h-[32px] dr:w-full dr:min-w-0 dr:rounded-[var(--decision-review-radius)] dr:px-[10px] dr:py-[6px] dr:disabled:cursor-not-allowed dr:disabled:opacity-55',
        className,
      )}
    />
  )
}
