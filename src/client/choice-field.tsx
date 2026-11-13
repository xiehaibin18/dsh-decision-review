/** @jsxRuntime classic */
import * as React from 'react'
import { Field, FieldDescription } from './ui/field.js'
import { RadioGroup, RadioGroupItem } from './ui/radio-group.js'

interface ChoiceFieldProps<Value extends string> {
  label: string
  hint: string
  value: Value
  items: readonly { value: Value; label: string }[]
  onChange: (value: Value) => void
}

export function ChoiceField<Value extends string>({ label, hint, value, items, onChange }: ChoiceFieldProps<Value>) {
  const id = React.useId()
  const hintId = id + '-hint'
  return (
    <Field>
      <span id={id} className="decision-review-field-title">
        {label}
      </span>
      <RadioGroup<Value> aria-labelledby={id} aria-describedby={hintId} value={value} onValueChange={onChange} required>
        {items.map((item) => (
          <RadioGroupItem key={item.value} value={item.value}>
            {item.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <FieldDescription id={hintId}>{hint}</FieldDescription>
    </Field>
  )
}
