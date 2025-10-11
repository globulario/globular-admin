class PageRbacRoles extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>RBAC — Roles</h2>
        <p>Define roles and assign actions.</p>
      </section>
    `
  }
}
customElements.define('page-rbac-roles', PageRbacRoles)