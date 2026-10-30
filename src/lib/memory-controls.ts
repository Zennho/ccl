export function syncMemoryControls(container: HTMLElement) {
  const mode = container.querySelector<HTMLSelectElement>('#memory-mode'),
    manual = container.querySelector<HTMLElement>('#memory-manual');
  if (mode && manual) manual.hidden = mode.value !== 'manual';
  const value = container.querySelector<HTMLInputElement>('#memory'),
    slider = container.querySelector<HTMLInputElement>('#memory-range');
  if (mode && value) value.disabled = mode.value !== 'manual';
  if (mode && slider) slider.disabled = mode.value !== 'manual';
  if (value && slider && value.value) slider.value = value.value;
  const instanceMode = container.querySelector<HTMLSelectElement>('#instance-memory-mode');
  const instanceValue = container.querySelector<HTMLInputElement>('#instance-memory'),
    instanceSlider = container.querySelector<HTMLInputElement>('#instance-memory-range');
  const instanceForm = container.querySelector<HTMLFormElement>('#instance-settings-form');
  if (instanceForm) {
    for (const [id, name] of [
      ['instance-java-fields', 'overrideJava'],
      ['instance-memory-fields', 'overrideMemory'],
      ['instance-args-fields', 'overrideArgs'],
    ]) {
      const field = instanceForm.querySelector<HTMLFieldSetElement>(`#${id}`),
        control = instanceForm.elements.namedItem(name);
      if (field && control instanceof HTMLInputElement) field.disabled = !control.checked;
    }
    const section = instanceForm.querySelector<HTMLElement>('#instance-memory-manual');
    if (section && instanceMode) section.hidden = instanceMode.value !== 'manual';
    if (instanceValue && instanceMode) instanceValue.disabled = instanceMode.value !== 'manual';
  }
  if (instanceMode && instanceSlider) instanceSlider.disabled = instanceMode.value !== 'manual';
  if (instanceValue && instanceSlider && instanceValue.value)
    instanceSlider.value = instanceValue.value;
}
