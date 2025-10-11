class PageConsole extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>Console</h2>
        <p>Interactive command console for admin tasks.</p>
      </section>
    `
  }
}
customElements.define('page-console', PageConsole)