/**
 * Find the nearest scrollable ancestor of an element.
 * Used to handle both window scrolling and custom scroll containers.
 */
export function findScrollContainer(element: Element | null): Element | null {
  if (!element) return null;

  let current = element.parentElement;
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (/(auto|scroll)/.test(overflow + overflowY)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}
