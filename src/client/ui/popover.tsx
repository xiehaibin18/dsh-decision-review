/** @jsxRuntime classic */
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import * as React from 'react'
import { cn } from './utils.js'

export const Popover = PopoverPrimitive.Root

export function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

type PopoverContentProps = PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'> & {
    container: HTMLElement | null
  }

export function PopoverContent({
  className,
  container,
  align = 'center',
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="decision-review-popover-positioner dr:isolate"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn('decision-review-popover', className)}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('decision-review-popover-title', className)}
      {...props}
    />
  )
}
