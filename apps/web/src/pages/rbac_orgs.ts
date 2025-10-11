class PageRbacOrganizations extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>RBAC — Organizations</h2>
        <p>Tenants/organizations and scopes.</p>
      </section>
    `
  }
}
customElements.define('page-rbac-organizations', PageRbacOrganizations)