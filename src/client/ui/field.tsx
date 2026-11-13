/** @jsxRuntime classic */
import * as React from 'react'
import { cn } from './utils.js'

export function Field({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      role="group"
      data-slot="field"
      data-orientation="vertical"
      className={cn('dr:flex dr:w-full dr:min-w-0 dr:flex-col dr:gap-[4px]', className)}
    />
  )
}

export function FieldLabel({ className, ...props }: React.ComponentPropsWithoutRef<'label'>) {
  return (
    <label
      {...props}
      data-slot="field-label"
      className={cn('dr:flex dr:w-fit dr:items-center dr:[font-weight:500] dr:select-none', className)}
    />
  )
}

export function FieldDescription({ className, ...props }: React.ComponentPropsWithoutRef<'p'>) {
  return <p {...props} data-slot="field-description" className={cn('decision-review-field-description', className)} />
}
