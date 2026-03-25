// paper-ripple: Material ripple effect. Registered as no-op placeholder;
// the visual effect is handled by CSS :active/:hover states in the parent.
class PaperRipple extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none'
  }
}

if (!customElements.get('paper-ripple')) customElements.define('paper-ripple', PaperRipple)
