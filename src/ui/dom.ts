type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  title?: string;
  text?: string;
  html?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

/** Fabrique d'éléments minimaliste : suffisant pour une UI d'app, sans framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.type) (el as HTMLInputElement).type = props.type;
  if (props.value !== undefined) (el as HTMLInputElement).value = props.value;
  if (props.placeholder) (el as HTMLInputElement).placeholder = props.placeholder;
  if (props.disabled !== undefined) (el as HTMLButtonElement).disabled = props.disabled;
  if (props.hidden !== undefined) el.hidden = props.hidden;
  if (props.style) Object.assign(el.style, props.style);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.on) {
    for (const [name, fn] of Object.entries(props.on)) {
      el.addEventListener(name, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function iconButton(
  icon: string,
  title: string,
  onClick: () => void,
  extraClass = '',
): HTMLButtonElement {
  return h('button', {
    class: `icon-btn ${extraClass}`.trim(),
    title,
    html: icon,
    attrs: { 'aria-label': title },
    on: { click: onClick },
  });
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Ferme le popover au prochain clic extérieur ou sur Échap. */
export function dismissOnOutside(panel: HTMLElement, close: () => void) {
  const onDown = (e: PointerEvent) => {
    if (!panel.contains(e.target as Node)) finish();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') finish();
  };
  function finish() {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    close();
  }
  // Différé : sinon le clic qui vient d'ouvrir le panneau le referme aussitôt.
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  return finish;
}
