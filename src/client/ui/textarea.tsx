/** @jsxRuntime classic */
import * as React from 'react'
import { cn } from './utils.js'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        data-slot="textarea"
        className={cn(
          'decision-review-control decision-review-input dr:block dr:min-h-[64px] dr:w-full dr:min-w-0 dr:resize-y dr:rounded-[var(--decision-review-radius)] dr:px-[10px] dr:py-[6px] dr:disabled:cursor-not-allowed dr:disabled:opacity-55',
          className,
        )}
      />
    )
  },
)
