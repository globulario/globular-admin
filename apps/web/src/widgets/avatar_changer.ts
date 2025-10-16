// src/components/avatar-changer.ts
import { updateAccount } from "../backend/rbac/accounts"; // keep if you want auto-persist

// TypeScript declaration for Vite's import.meta.glob
interface ImportMeta {
  glob: (
    pattern: string,
    options?: { eager?: boolean; as?: string }
  ) => Record<string, unknown>;
}

type SrcItem = { name: string; src: string }; // src is URI-encoded

export class AvatarChanger extends HTMLElement {
  private shadow!: ShadowRoot;
  private preview!: HTMLDivElement;
  private nameEl!: HTMLSpanElement;
  private selectorEl!: HTMLDivElement;
  private nextBtn!: HTMLElement;
  private prevBtn!: HTMLElement;
  private setBtn!: HTMLElement;
  private cancelBtn!: HTMLElement;
  private uploadInput!: HTMLInputElement;

  private srcList: SrcItem[] = [];
  private activeKey = 0;

  /** Public attributes */
  get accountId(): string | null {
    return this.getAttribute("account-id");
  }
  set accountId(v: string | null) {
    if (v) this.setAttribute("account-id", v);
    else this.removeAttribute("account-id");
  }

  /** Optional: initial image path (absolute URL or dataURL) */
  get value(): string | null {
    return this.getAttribute("value");
  }
  set value(v: string | null) {
    if (v) this.setAttribute("value", v);
    else this.removeAttribute("value");
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.innerHTML = this.template();
  }

  connectedCallback() {
    this.hookRefs();
    this.hookEvents();
    // Load images from Vite's public folder (mounted at site root)
    this.loadImages("/img/pixmaps/faces");
  }

  // ---------- UI & events ----------

  private hookRefs() {
    this.preview = this.$("#preview");
    this.nameEl = this.$<HTMLSpanElement>("#name");
    this.selectorEl = this.$("#selector");
    this.nextBtn = this.$(".next-btn");
    this.prevBtn = this.$(".last-btn");
    this.setBtn = this.$("#set-btn");
    this.cancelBtn = this.$("#cancel-btn");
    this.uploadInput = this.$("#upload");
  }

  private hookEvents() {
    // nav
    this.nextBtn.addEventListener("click", () => this.showNext());
    this.prevBtn.addEventListener("click", () => this.showPrev());

    // name editing
    this.nameEl.addEventListener("blur", () => this.commitName());
    this.nameEl.addEventListener("keyup", (e: KeyboardEvent) => {
      if (e.key === "Enter") this.commitName();
    });

    // Set
    this.setBtn.addEventListener("click", async () => {
      const item = this.srcList[this.activeKey];
      const detail = {
        name: this.nameEl.textContent || "",
        src: item?.src ? decodeURIComponent(item.src) : "",
      };
      this.dispatchEvent(new CustomEvent("image-changed", { detail }));

      // Optional: persist immediately via backend (auto-save)
      if (this.accountId && item?.src) {
        try {
          await updateAccount(this.accountId, {
            profilePicture: decodeURIComponent(item.src),
          });
        } catch (err) {
          console.error("updateAccount(profilePicture) failed:", err);
        }
      }
    });

    // Cancel
    this.cancelBtn.addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("cancel"))
    );

    // Upload
    this.uploadInput.addEventListener("change", (evt: Event) => {
      const files = (evt.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      Array.from(files).forEach((file) => this.addUpload(file));
      this.uploadInput.value = ""; // reset
    });
  }

  private commitName() {
    const k = this.activeKey;
    const s = (this.nameEl.textContent || "").trim();
    if (!s || !Number.isInteger(k)) return;
    this.srcList[k].name = s;
    this.nameEl.textContent = s;
  }

  private addUpload(file: File) {
    if (!/^image\//.test(file.type)) return;
    const url = URL.createObjectURL(file);
    const key = this.add({ name: file.name, src: encodeURIComponent(url) });
    this.showByKey(key);
  }

  private add(item: SrcItem): number {
    this.srcList.push(item);
    return this.srcList.length - 1;
  }

  private showNext() {
    if (this.srcList.length === 0) return;
    const n = (this.activeKey + 1) % this.srcList.length;
    this.showByKey(n);
  }
  private showPrev() {
    if (this.srcList.length === 0) return;
    const n = (this.activeKey - 1 + this.srcList.length) % this.srcList.length;
    this.showByKey(n);
  }

  private showByKey(idx: number) {
    const item = this.srcList[idx];
    if (!item) return;
    // clear preview
    this.preview.textContent = "";
    const img = document.createElement("img");
    img.src = decodeURIComponent(item.src);
    img.className = "avatar_img avatar_img--loading";
    img.onload = () => img.classList.remove("avatar_img--loading");
    this.preview.appendChild(img);

    this.nameEl.textContent = item.name || "";
    this.activeKey = idx;
  }

  // ---------- Data (Vite glob) ----------

  /**
   * Loads all images from /public/img/pixmaps/faces using Vite's import.meta.glob.
   * `path` is kept for API compatibility but unused (we filter by it anyway).
   */
// src/components/avatar-changer.ts
// ...imports stay the same

// inside loadImages()
private async loadImages(_path: string) {
  // ✅ glob from /src, not /public
  const faceImgs = import.meta.glob(
    '../assets/pixmaps/faces/**/*.{png,jpg,jpeg,webp,svg,gif}',
    { eager: true, as: 'url' }
  ) as Record<string, string>;

  // build list + thumbs
  Object.entries(faceImgs).forEach(([key, url]) => {
    const filename = key.split('/').pop() || '';
    const base = filename.replace(/\.[^.]+$/, '');
    const parts = base.split('_');                 // keep your "a_John.png" naming
    const name = parts.length > 1 ? parts.slice(1).join('_') : base;

    this.srcList.push({ name, src: encodeURIComponent(url) });

    const thumb = document.createElement('img');
    thumb.src = url;
    thumb.className = 'thumb';
    thumb.title = name;
    thumb.addEventListener('click', () => this.showByKey(this.indexOfSrc(url)));
    this.selectorEl.appendChild(thumb);
  });

  if (!this.srcList.length) return;

  // try initial value by full url, else by filename fallback
  const byUrl = this.indexOfSrc(this.value ?? '');
  let idx = byUrl;
  if (idx < 0 && this.value) {
    const wantFile = (this.value.split('/').pop() || '').toLowerCase();
    idx = this.srcList.findIndex(s => decodeURIComponent(s.src).toLowerCase().endsWith('/' + wantFile));
  }
  this.showByKey(idx >= 0 ? idx : 0);
}

  private indexOfSrc(raw: string): number {
    const enc = encodeURIComponent(raw);
    return this.srcList.findIndex((s) => s.src === enc);
  }

  // ---------- Utils ----------

  private $<T extends Element = HTMLElement>(sel: string): T {
    const el = this.shadow.querySelector(sel);
    if (!el) throw new Error(`AvatarChanger: missing ${sel}`);
    return el as T;
  }

  private template() {
    return /*html*/ `
<style>
  :host{ display:block }
  .wrap { text-align:center; width: 600px; margin:0 auto; }
  .profile{
    margin:auto; width:95%; max-width:600px;
    background: var(--surface-color);
    border-radius: 10px;
    padding: 15px 10px 5px;
    position: relative;
    box-shadow: 0 0 0 1px var(--divider-color, color-mix(in srgb, var(--on-surface-color) 12%, var(--surface-color)));
  }
  .profile__options{
    display:flex; flex-wrap:nowrap; width:90%; margin:auto;
    justify-content:space-between; padding-bottom:10px; color:#666;
  }
  .btn{ cursor:pointer; user-select:none }
  .avatar{
    width:96px; height:96px; border-radius:5px;
    border: 2px solid #fff; margin:10px auto; position:relative; overflow:hidden;
  }
  #preview::after{
    content:'Loading...'; display:block; position:absolute; inset:0;
    text-align:center; line-height:96px; color:#999;
  }
  #preview:has(img){ position:relative; }
  .avatar_img { width:100%; height:auto; transform:scale(1); transition:opacity .2s; opacity:1; }
  .avatar_img--loading { opacity:.2 }
  .avatar_upload{
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    background: rgb(116 123 125 / 60%); opacity:0; transition:opacity .3s;
  }
  .avatar:hover .avatar_upload{ opacity:1 }
  .upload_label{
    color:#111; text-transform:uppercase; font-size:14px; cursor:pointer; padding:4px 8px;
    border-radius:4px; background:#fff;
  }
  #upload{ display:none }
  .nickname{ text-align:center; font-weight:400; font-size:20px; color:#666; margin-top:4px; }
  #name{ outline:none }
  #name:focus{ box-shadow:0 0 0 2px var(--divider-color) inset; border-radius:4px }
  #selector { display:flex; flex-wrap:wrap; padding: 12px; justify-content:center; gap:6px; }
  #selector > img.thumb{
    width:50px; height:50px; padding:3px; border-radius:5px; border:2px solid transparent; object-fit:cover;
  }
  #selector > img.thumb:hover{ border-color: var(--divider-color) }
  .actions{ display:flex; gap:.5rem; justify-content:flex-end; padding:10px }
  button{
    font: inherit; font-size: .9rem; padding:.35rem .75rem; border-radius:6px;
    border: 1px solid var(--divider-color);
    background: var(--surface-color); color: var(--on-surface-color);
  }
</style>
<div class="wrap">
  <div class="profile">
    <div class="profile__options">
      <label class="upload_label">
        Upload
        <input type="file" id="upload" accept="image/*" />
      </label>
      <a class="last-btn btn" title="Previous" aria-label="Previous">❮</a>
      <a class="next-btn btn" title="Next" aria-label="Next">❯</a>
    </div>

    <div class="avatar" id="avatar">
      <div id="preview"></div>
      <div class="avatar_upload"><span class="upload_label">Upload</span></div>
    </div>

    <div class="nickname">
      <span id="name" tabindex="0" contenteditable="true"></span>
    </div>

    <div id="selector"></div>

    <div class="actions">
      <button id="set-btn">Set</button>
      <button id="cancel-btn">Cancel</button>
    </div>
  </div>
</div>
`;
  }
}

// register
customElements.define("avatar-changer", AvatarChanger);
export default AvatarChanger;
