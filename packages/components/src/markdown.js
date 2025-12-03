// src/widgets/markdown.js
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/iron-icons/iron-icons.js';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// Markdown parser
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

class Markdown extends HTMLElement {
  static get observedAttributes() {
    return ['language', 'content-bg', 'content-fg', 'code-bg', 'code-fg', 'divider-color'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.defaultLanguage = 'plaintext';
    this.original = '';

    this.shadow.innerHTML = `
      <style>
        :host { display:block; }

        /* Hide the raw markdown text or light DOM elements passed to slot */
        slot { display: none !important; }
        ::slotted(*) { display: none !important; }

        .wrap {
          background: var(--surface-color);
          color: var(--on-surface-color);
          border-radius: .5rem;
          border: 1px solid var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, transparent));
          padding: 1rem 1.25rem;
          overflow: auto;
          line-height: 1.6;
          font: 400 1rem/1.6 system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
        }

        .wrap :is(h1,h2,h3,h4,h5,h6) {
          color: var(--on-surface-color);
          margin: 1.2em 0 .6em;
          line-height: 1.25;
        }

        .wrap p { margin: .6em 0; }
        .wrap a { color: var(--primary-color); text-decoration: none; }
        .wrap a:hover { text-decoration: underline; }

        .wrap blockquote {
          margin: .8em 0;
          padding: .5em .9em;
          border-left: 3px solid color-mix(in srgb, var(--on-surface-color) 35%, transparent);
          background: color-mix(in srgb, var(--on-surface-color) 6%, transparent);
          border-radius: .25rem;
        }

        .wrap ul, .wrap ol { padding-left: 1.25rem; }

        pre {
          position: relative;
          margin: 1rem 0;
          border-radius: .5rem;
          overflow: auto;
          background: var(--md-code-bg, color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color)));
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--on-surface-color) 10%, transparent);
        }

        pre > code.hljs {
          display: block;
          padding: 1rem;
          background: transparent;
          color: var(--md-code-fg, var(--on-surface-color));
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: .95rem;
        }

        :where(.wrap) code:not(.hljs) {
          padding: .12rem .35rem;
          border-radius: .35rem;
          background: color-mix(in srgb, var(--on-surface-color) 8%, transparent);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .copy {
          position: absolute;
          top: .5rem;
          right: .5rem;
          width: 34px; height: 34px;
          border-radius: .5rem;
          color: var(--on-surface-color);
          --paper-icon-button-ink-color: var(--on-surface-color);
          background: color-mix(in srgb, var(--on-surface-color) 10%, transparent);
        }
        .copy:hover {
          background: color-mix(in srgb, var(--on-surface-color) 16%, transparent);
        }

        .wrap :is(h1,h2,h3)+pre { margin-top: .5rem; }
      </style>

      <div id="content" class="wrap" part="content"></div>
      <slot></slot>
    `;
  }

  connectedCallback() {
    this.contentEl = this.shadow.querySelector('#content');
    this.slotEl = this.shadow.querySelector('slot');

    this.applyThemeVars();
    this.defaultLanguage = (this.getAttribute('language') || 'plaintext').trim();

    this.processSlot();
    this._onSlotChange = () => this.processSlot();
    this.slotEl.addEventListener('slotchange', this._onSlotChange);
  }

  disconnectedCallback() {
    if (this._onSlotChange) this.slotEl.removeEventListener('slotchange', this._onSlotChange);
  }

  attributeChangedCallback(name) {
    if (!this.isConnected) return;
    if (name === 'language') {
      this.defaultLanguage = (this.getAttribute('language') || 'plaintext').trim();
    }
    this.applyThemeVars();
  }

  applyThemeVars() {
    const contentBg = this.getAttribute('content-bg') || 'var(--surface-color)';
    const contentFg = this.getAttribute('content-fg') || 'var(--on-surface-color)';
    const codeBg = this.getAttribute('code-bg') || 'color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color))';
    const codeFg = this.getAttribute('code-fg') || 'var(--on-surface-color)';
    const divider = this.getAttribute('divider-color') || 'color-mix(in srgb, var(--on-surface-color) 12%, transparent)';

    this.style.setProperty('--content-bg-color', contentBg);
    this.style.setProperty('--content-text-color', contentFg);
    this.style.setProperty('--md-code-bg', codeBg);
    this.style.setProperty('--md-code-fg', codeFg);
    this.style.setProperty('--divider-color', divider);
  }

  processSlot() {
    if (!this.slotEl || !this.contentEl) return;
    let text = '';
    const nodes = this.slotEl.assignedNodes({ flatten: true });
    for (const n of nodes) text += n.textContent || '';
    this.original = text.trim();

    if (!this.original) {
      this.contentEl.innerHTML = '';
      return;
    }

    this.contentEl.innerHTML = md.render(this.original);
    this.decorateCodeBlocks();

    // Optional: physically remove the source text after rendering
    if (this.hasAttribute('strip-source')) {
      const nodes = this.slotEl.assignedNodes({ flatten: true });
      nodes.forEach((n) => {
        if (n.parentNode === this) n.parentNode.removeChild(n);
      });
    }
  }

  decorateCodeBlocks() {
    const blocks = this.shadow.querySelectorAll('pre > code');
    blocks.forEach((codeEl) => {
      const block = codeEl;
      const cls = block.className || '';
      const langMatch = /language-(\S+)/.exec(cls);
      const lang = (langMatch && langMatch[1]) || this.defaultLanguage;
      const raw = block.textContent || '';

      try {
        const out = lang
          ? hljs.highlight(raw, { language: lang }).value
          : hljs.highlightAuto(raw).value;
        block.innerHTML = out;
        block.classList.add('hljs');
      } catch (e) {
        block.textContent = raw; // fallback
      }

      const pre = block.parentElement;
      if (!pre) return;

      const existing = pre.querySelector('.copy');
      if (existing) existing.remove();

      const btn = document.createElement('paper-icon-button');
      btn.className = 'copy';
      btn.setAttribute('icon', 'icons:content-copy');
      btn.setAttribute('title', 'Copy code');
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(raw);
          btn.setAttribute('icon', 'icons:check');
          setTimeout(() => btn.setAttribute('icon', 'icons:content-copy'), 900);
        } catch {
          btn.setAttribute('icon', 'icons:error');
          setTimeout(() => btn.setAttribute('icon', 'icons:content-copy'), 900);
        }
      });
      pre.appendChild(btn);
    });
  }

  getMarkdown() {
    return this.original;
  }
}

customElements.define('globular-markdown', Markdown);