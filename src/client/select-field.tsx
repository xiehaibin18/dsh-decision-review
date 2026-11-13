/** @jsxRuntime classic */
import * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'

interface SelectFieldProps<Value extends string> extends React.AriaAttributes {
  id: string
  container: HTMLElement | null
  items: readonly { value: Value; label: string }[]
  value: Value | null
  onChange: (value: Value) => void
  placeholder?: string
  className?: string
}

export function SelectField<Value extends string>({
  id,
  container,
  items,
  value,
  onChange,
  placeholder,
  className,
  ...aria
}: SelectFieldProps<Value>) {
  return (
    <Select<Value>
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
      modal={false}
    >
      <SelectTrigger id={id} className={className} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent container={container}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
