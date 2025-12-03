class PageDashboard extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Dashboard</h2>
        <p>System overview, health, quick actions.</p>
      </section>
    `
  }
}
customElements.define('page-dashboard', PageDashboard)