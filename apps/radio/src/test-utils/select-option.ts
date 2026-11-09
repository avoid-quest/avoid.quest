/** Select by its visible label, rather than relying on a hidden native select. */
export async function chooseSelectOption(
  container: HTMLElement,
  label: string,
  name = "Platform"
) {
  const { fireEvent, waitFor, within } = await import("@testing-library/react");
  const trigger = within(container).getByRole("combobox", { name });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const body = within(document.body);
  const option = await body.findByRole("option", { name: label });
  fireEvent.pointerDown(option, { button: 0, pointerType: "mouse" });
  fireEvent.click(option);
  await waitFor(() => {
    if (body.queryByRole("listbox")) {
      throw new Error("Select has not finished closing");
    }
  });
}
