/** Native keyboard names; text entry stays on the separate editable-field route. */
export function isNativeKeyChord(key: unknown): key is string {
  if (typeof key !== 'string' || key.length > 80) return false;
  const parts = key.split('+');
  const base = parts.pop();
  if (!base) return false;
  const modifiers = new Set<string>();
  for (const part of parts) {
    if (!['Meta', 'Shift', 'Alt', 'Option', 'Control'].includes(part)) return false;
    const modifier = part === 'Option' ? 'Alt' : part;
    if (modifiers.has(modifier)) return false;
    modifiers.add(modifier);
  }
  if (['Enter', 'Tab', 'Escape', 'Space', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(base)) return true;
  return /^[A-Z0-9]$/.test(base) && ['Meta', 'Alt', 'Control'].some(modifier => modifiers.has(modifier));
}
