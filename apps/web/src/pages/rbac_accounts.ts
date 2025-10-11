class PageRbacAccounts extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>RBAC — Accounts</h2>
        <p>Manage accounts and credentials.</p>
      </section>
    `
  }
}
customElements.define('page-rbac-accounts', PageRbacAccounts)