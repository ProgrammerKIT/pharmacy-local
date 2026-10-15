// Small inert test DOM: models node replacement, focus loss and id lookup.
// No browser, storage, event synthesis, or application data access.
export function uiNodeFixture() {
  const elements = new Map();
  const document = { activeElement: null };
  const voidTags = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = attrs; this.id = attrs.id || '';
      this.children = []; this.parentElement = null; this.dataset = {}; this.text = '';
      this.open = Object.hasOwn(attrs, 'open'); this.hidden = Object.hasOwn(attrs, 'hidden');
      this.disabled = Object.hasOwn(attrs, 'disabled'); this.value = attrs.value || ''; this.isConnected = true;
      for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      if (this.id) elements.set(this.id, this);
    }
    querySelector(selector) {
      const wanted = selector.startsWith('#') ? selector.slice(1) : null;
      for (const child of this.children) if (child instanceof Element) {
        if (wanted ? child.id === wanted : child.tagName.toLowerCase() === selector) return child;
        const found = child.querySelector(selector); if (found) return found;
      }
      return null;
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.tagName.toLowerCase() === selector) return node; return null; }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = null; }
    removeChildren() {
      const detach = node => {
        if (!(node instanceof Element)) return;
        node.isConnected = false; if (document.activeElement === node) document.activeElement = null;
        if (node.id && elements.get(node.id) === node) elements.delete(node.id);
        node.children.forEach(detach);
      };
      this.children.forEach(detach); this.children = [];
    }
    get innerHTML() { return this.children.map(node => typeof node === 'string' ? node : node.outerHTML).join(''); }
    set innerHTML(html) {
      this.removeChildren(); const stack = [this];
      for (const token of String(html).match(/<[^>]*>|[^<]+/g) || []) {
        if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        if (token.startsWith('<')) {
          const match = /^<([a-zA-Z][\w-]*)([\s\S]*?)\/?\s*>$/.exec(token);
          if (!match) continue;
          const attrs = {};
          for (const attr of match[2].matchAll(/([\w:-]+)(?:="([^"]*)"|'([^']*)'|=([^\s>]+))?/g)) attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? '';
          const node = new Element(match[1], attrs); node.parentElement = stack.at(-1); node.parentElement.children.push(node);
          if (!voidTags.has(match[1].toLowerCase())) stack.push(node);
        } else stack.at(-1).children.push(token);
      }
    }
    get outerHTML() {
      const attrs = { ...this.attrs };
      for (const name of ['open', 'hidden', 'disabled']) { if (this[name]) attrs[name] = ''; else delete attrs[name]; }
      const start = '<' + this.tagName.toLowerCase() + Object.entries(attrs).map(([name, value]) => value === '' ? ' ' + name : ` ${name}="${value}"`).join('') + '>';
      return voidTags.has(this.tagName.toLowerCase()) ? start : start + this.innerHTML + '</' + this.tagName.toLowerCase() + '>';
    }
    get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); }
    set textContent(value) { this.removeChildren(); this.children = [String(value)]; }
    replaceChildren() { this.removeChildren(); }
    close() { this.open = false; }
  }
  const node = id => elements.get(id) || new Element('div', { id });
  return { document, elements, node };
}
