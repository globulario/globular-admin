class PageStorageVolumes extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Storage Volumes</h2>
        <p>Host mount points, capacity, and IO pressure indicators.</p>
      </section>
    `
  }
}
customElements.define('page-storage-volumes', PageStorageVolumes)
