/** A query refresh can replace the form before observer-level callbacks run. */
export async function completeJobApplication(submit: () => Promise<unknown>, onSubmitted: () => void): Promise<void> {
  try {
    await submit();
  } catch {
    // The mutation retains its error for the form's existing feedback.
    return;
  }
  onSubmitted();
}
