/** @jsxRuntime classic */
import { Select as SelectPrimitive } from '@base-ui/react/select'
import * as React from 'react'
import { cn } from './utils.js'

export const Select = SelectPrimitive.Root

export function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

export function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      {...props}
      data-slot="select-trigger"
      className={cn(
        'decision-review-control decision-review-input dr:flex dr:min-h-[32px] dr:w-full dr:min-w-0 dr:items-center dr:justify-between dr:gap-[8px] dr:rounded-[var(--decision-review-radius)] dr:px-[10px] dr:py-[6px] dr:text-start dr:select-none dr:enabled:cursor-pointer dr:disabled:cursor-not-allowed dr:disabled:opacity-55',
        className,
      )}
    >
      {children}
      <SelectPrimitive.Icon render={<Chevron />} />
    </SelectPrimitive.Trigger>
  )
}

type SelectContentProps = SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'collisionBoundary'> & {
    container: HTMLElement | null
  }

export function SelectContent({ className, children, container, collisionBoundary, ...props }: SelectContentProps) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        side="bottom"
        sideOffset={4}
        align="start"
        alignItemWithTrigger={false}
        collisionBoundary={collisionBoundary}
        collisionPadding={6}
        className="decision-review-select-positioner dr:isolate"
      >
        <SelectPrimitive.Popup
          {...props}
          data-slot="select-content"
          className={cn(
            'decision-review-select-content dr:relative dr:isolate dr:max-h-(--available-height) dr:w-(--anchor-width) dr:overflow-x-hidden dr:overflow-y-auto dr:rounded-[var(--decision-review-radius)] dr:p-[4px]',
            className,
          )}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      {...props}
      data-slot="select-item"
      className={cn(
        'decision-review-select-item dr:relative dr:flex dr:w-full dr:cursor-default dr:items-center dr:justify-between dr:gap-[8px] dr:rounded-[var(--decision-review-item-radius)] dr:px-[8px] dr:py-[6px] dr:select-none dr:data-disabled:pointer-events-none dr:data-disabled:opacity-55',
        className,
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator render={<span className="decision-review-select-indicator" />}>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectScrollUpButton() {
  return (
    <SelectPrimitive.ScrollUpArrow className="decision-review-select-scroll dr:sticky dr:top-0 dr:flex dr:w-full dr:justify-center">
      <Chevron up />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton() {
  return (
    <SelectPrimitive.ScrollDownArrow className="decision-review-select-scroll dr:sticky dr:bottom-0 dr:flex dr:w-full dr:justify-center">
      <Chevron />
    </SelectPrimitive.ScrollDownArrow>
  )
}

function Chevron({ up, ...props }: React.ComponentPropsWithoutRef<'svg'> & { up?: boolean }) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="decision-review-select-chevron dr:pointer-events-none dr:shrink-0"
    >
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  )
}
