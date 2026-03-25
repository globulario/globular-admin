class IronCollapse extends HTMLElement {
  static observedAttributes = ['opened']

  constructor() {
    super()
    this.style.display = 'block'
    this.style.overflow = 'hidden'
    this.style.transition = 'height .3s ease, opacity .3s ease'
  }

  connectedCallback() { this._apply(false) }
  attributeChangedCallback() { this._apply(true) }

  get opened(): boolean { return this.hasAttribute('opened') }
  set opened(v: boolean) { v ? this.setAttribute('opened', '') : this.removeAttribute('opened') }

  toggle() { this.opened = !this.opened }
  show() { this.opened = true }
  hide() { this.opened = false }

  private _apply(animate: boolean) {
    if (this.opened) {
      this.style.height = ''
      this.style.opacity = '1'
      this.hidden = false
    } else {
      if (animate) {
        this.style.height = this.scrollHeight + 'px'
        requestAnimationFrame(() => {
          this.style.height = '0'
          this.style.opacity = '0'
        })
      } else {
        this.style.height = '0'
        this.style.opacity = '0'
      }
    }
  }
}

if (!customElements.get('iron-collapse')) customElements.define('iron-collapse', IronCollapse)
