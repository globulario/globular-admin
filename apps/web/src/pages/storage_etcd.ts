class PageStorageEtcd extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>etcd</h2>
        <p>Members, leader, alarms, and snapshot/restore actions.</p>
      </section>
    `
  }
}
customElements.define('page-storage-etcd', PageStorageEtcd)
