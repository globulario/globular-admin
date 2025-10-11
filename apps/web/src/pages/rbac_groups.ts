class PageRbacGroups extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>RBAC — Groups</h2>
        <p>Create groups and manage members.</p>
      </section>
    `
  }
}
customElements.define('page-rbac-groups', PageRbacGroups)