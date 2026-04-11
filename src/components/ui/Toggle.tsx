interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
}

export function Toggle({ checked, onChange, id }: ToggleProps) {
  return (
    <div className="toggle-wrap">
      <label className="toggle">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="toggle-track" />
      </label>
    </div>
  )
}
