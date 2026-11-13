/** @jsxRuntime classic */
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from './utils.js'

const buttonVariants = cva(
  'decision-review-control dr:inline-flex dr:min-h-[32px] dr:max-w-full dr:shrink-0 dr:items-center dr:justify-center dr:gap-[6px] dr:rounded-[var(--decision-review-radius)] dr:px-[12px] dr:py-[6px] dr:[font-weight:500] dr:select-none dr:enabled:cursor-pointer dr:disabled:opacity-55',
  {
    variants: {
      variant: {
        default: 'decision-review-button-primary dr:[font-weight:600]',
        outline: 'decision-review-button-outline',
        ghost: 'decision-review-button-ghost',
        destructive: 'decision-review-button-destructive',
      },
      size: {
        default: '',
        sm: 'dr:min-h-[28px] dr:px-[8px] dr:py-[2px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof ButtonPrimitive> & VariantProps<typeof buttonVariants>
>(function Button({ className, variant, size, type = 'button', ...props }, ref) {
  return (
    <ButtonPrimitive
      {...props}
      ref={ref}
      type={type}
      data-slot="button"
      data-variant={variant ?? 'default'}
      className={cn(buttonVariants({ variant, size }), className)}
    />
  )
})
