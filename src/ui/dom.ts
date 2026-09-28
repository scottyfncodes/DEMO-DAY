type Child = Node | string | null | undefined | false;

type Props = Record<string, unknown> & {
  class?: string;
  text?: string;
  html?: string;
  onClick?: (ev: MouseEvent) => void;
};

/** Tiny hyperscript helper so screens can be built without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key === 'onClick') el.addEventListener('click', value as EventListener);
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for' || key === 'type' || key === 'id') {
      el.setAttribute(key, String(value));
    } else if (key in el) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function stars(n: number, max = 5): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
}

/** Requests a haptic pulse where supported (Android Chrome); silently ignored elsewhere. */
export function haptic(pattern: number | number[] = 12): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
