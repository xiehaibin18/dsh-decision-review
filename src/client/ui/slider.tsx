/** @jsxRuntime classic */
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import * as React from 'react'
import { cn } from './utils.js'

type SliderProps = SliderPrimitive.Root.Props<number> &
  Pick<SliderPrimitive.Thumb.Props, 'aria-labelledby' | 'aria-describedby' | 'getAriaValueText'>

export function Slider({
  className,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  getAriaValueText,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root<number>
      {...props}
      data-slot="slider"
      className={cn('dr:w-full', className)}
      thumbAlignment="center"
    >
      <SliderPrimitive.Control className="decision-review-slider-control dr:relative dr:flex dr:w-full dr:items-center dr:select-none">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="decision-review-slider-track dr:relative dr:w-full dr:overflow-hidden"
        >
          <SliderPrimitive.Indicator data-slot="slider-range" className="decision-review-slider-range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          className="decision-review-slider-thumb"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          getAriaValueText={getAriaValueText}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
