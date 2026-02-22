class PageAdminBackups extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Backups</h2>
        <p>Backup and restore cluster state, databases, and configuration snapshots.</p>
      </section>
    `
  }
}
customElements.define('page-admin-backups', PageAdminBackups)
