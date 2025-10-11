class PageDashboard extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>Dashboard</h2>
        <p>System overview, health, quick actions.</p>
      </section>
    `
  }
}
customElements.define('page-dashboard', PageDashboard)