import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-slider/paper-slider.js';
import '@polymer/iron-icon/iron-icon.js';

import { createThumbmail, fireResize } from './utility';
import domtoimage from 'dom-to-image';

// ✅ new: use the refactored file backend helpers (names align with your latest files.ts)
import { getFile as getFileMeta, buildFileUrl } from '../backend/cms/files';
import { displayError, displayMessage } from '../backend/ui/notify';

/**
 * Custom Web Component for an image cropper.
 * Allows users to upload an image, crop it and get the cropped image.
 */
export class ImageCropper extends HTMLElement {
  constructor() {
    super();
    this.oldSrc = '';
    this.croppedImage = null;
    this.attachShadow({ mode: 'open' });
  }

  get width()  { return this.hasAttribute('width'); }
  get height() { return this.hasAttribute('height'); }
  get rounded(){ return this.hasAttribute('rounded'); }

  setCropImage(dataUrl) { this.croppedImage = dataUrl; }

  // Set the image from data url.
  setImage(data) { this.loadPic({ target: { files: [data] } }) }

  loadPic(e) {
    this.resetAll();
    const reader = new FileReader();
    reader.readAsDataURL(e.target.files[0]);

    reader.onload = (event) => {
      this.shadowRoot.querySelector(".resize-image").setAttribute('src', event.target.result);
      this.oldSrc = event.target.result;
      this.shadowRoot.querySelector(".resize-image").cmp = this.shadowRoot;
      this.shadowRoot.querySelector(".resize-image").onload = () => {
        this.shadowRoot.querySelector('.slidecontainer').style.display = 'block';
        this.shadowRoot.querySelector('.crop').style.display = 'inline-flex';

        const widthTotal = this.shadowRoot.querySelector(".resize-image").offsetWidth;
        this.shadowRoot.querySelector(".resize-container").style.width = widthTotal + 'px';
        this.shadowRoot.querySelector(".resize-image").style.width = widthTotal + 'px';
        this.shadowRoot.querySelector("#myRange").max = widthTotal + widthTotal;
        this.shadowRoot.querySelector("#myRange").value = widthTotal;
        this.shadowRoot.querySelector("#myRange").min = widthTotal - widthTotal;
      };
    };
  }

  dragElement(elmnt) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    elmnt.onmousedown = dragMouseDown;
    elmnt.ontouchstart = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX || e.targetTouches[0].pageX;
      pos4 = e.clientY || e.targetTouches[0].pageY;
      document.onmouseup = closeDragElement;
      document.ontouchend = closeDragElement;
      document.onmousemove = elementDrag;
      document.ontouchmove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      pos1 = pos3 - (e.clientX || e.targetTouches[0].pageX);
      pos2 = pos4 - (e.clientY || e.targetTouches[0].pageY);
      pos3 = (e.clientX || e.targetTouches[0].pageX);
      pos4 = (e.clientY || e.targetTouches[0].pageY);
      elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
      elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
      document.onmouseup = '';
      document.ontouchend = '';
      document.onmousemove = '';
      document.ontouchmove = '';
    }
  }

  crop() {
    this.shadowRoot.querySelector('.crop').style.display = 'none';
    this.shadowRoot.querySelector('.reset').style.display = 'inline-flex';
    this.shadowRoot.querySelector('.slidecontainer').style.display = 'none';

    const image = this.shadowRoot.querySelector('.resize-image');

    const resize_canvas = document.createElement('canvas');
    resize_canvas.width = image.offsetWidth;
    resize_canvas.height = image.offsetHeight;
    resize_canvas.getContext('2d').drawImage(image, 0, 0, image.offsetWidth, image.offsetHeight);

    image.setAttribute('src', resize_canvas.toDataURL("image/jepg"));

    const imageContainer = this.shadowRoot.querySelector('.resize-container');
    const centerContainer = this.shadowRoot.querySelector('.center');
    const left = centerContainer.offsetLeft - imageContainer.offsetLeft;
    const top = centerContainer.offsetTop - imageContainer.offsetTop;
    const width = centerContainer.offsetWidth;
    const height = centerContainer.offsetHeight;

    const crop_canvas = document.createElement('canvas');
    crop_canvas.width = width;
    crop_canvas.height = height;
    crop_canvas.getContext('2d').drawImage(resize_canvas, left, top, width, height, 0, 0, width, height);

    const imageC = this.shadowRoot.querySelector('.imageCropped');
    imageC.src = crop_canvas.toDataURL("image/jepg");
    this.shadowRoot.querySelector('.resize-image').setAttribute('src', '');
  }

  slide(w) {
    this.shadowRoot.querySelector(".resize-container").style.width = (w) + 'px';
    this.shadowRoot.querySelector(".resize-image").style.width = (w) + 'px';
  }

  getCropped() {
    return this.shadowRoot.querySelector(".imageCropped").getAttribute('src');
  }

  resetAll() {
    this.shadowRoot.querySelector(".reset").style.display = 'none';
    this.shadowRoot.querySelector(".crop").style.display = 'none';
    this.shadowRoot.querySelector(".slidecontainer").style.display = 'none';
    this.shadowRoot.querySelector(".resize-container").removeAttribute('style');
    this.shadowRoot.querySelector(".resize-image").setAttribute('src', '');
    this.shadowRoot.querySelector(".imageCropped").setAttribute('src', '');
    this.shadowRoot.querySelector(".resize-image").style.width = '100%';
    this.shadowRoot.querySelector("#myRange").max = 10;
    this.shadowRoot.querySelector("#myRange").value = 5;
    this.shadowRoot.querySelector("#myRange").min = 0;
  }

  reset() {
    this.resetAll();
    this.shadowRoot.querySelector(".resize-image").setAttribute('src', this.oldSrc);
  }

  connectedCallback() {
    let minHeigth = this.getAttribute('min-height');
    let minHeight = minHeigth ? minHeigth : '350px';

    // Allow overrides but fall back to theme variables
    let backgroundColor = this.getAttribute('background-color') || 'var(--surface-elevated-color)';
    let onBackgroundColor = this.getAttribute('on-background-color') || 'var(--on-surface-color)';
    let buttonColor = this.getAttribute('button-color') || 'var(--primary-color)';
    let onButtonColor = this.getAttribute('on-button-color') || 'var(--on-primary-color)';

    let width = this.getAttribute('width') || '200px';
    let height = this.getAttribute('height') || '200px';
    let rounded = this.getAttribute('rounded') || '0px';

    this.shadowRoot.innerHTML = `
        <style>
          #container{
            background-color: ${backgroundColor};
            color: ${onBackgroundColor};
            position: relative;
            min-height: ${minHeight};
            padding: 8px 10px 10px;
            border-radius: 12px;
            border: 1px solid var(--border-subtle-color);
            box-shadow: var(--dockbar-shadow, 0 6px 18px rgba(0,0,0,0.08));
            display:flex;
            flex-direction:column;
            gap:8px;
          }

          .toolbar {
            display:flex;
            align-items:center;
            gap:6px;
          }

          .slidecontainer {
            flex:1;
            width: 100%;
            display:none;
            z-index: 1;
            margin-left:auto;
          }

          .slider {
            width:100%;
            --paper-slider-knob-color: ${buttonColor};
            --paper-slider-active-color: ${buttonColor};
            --paper-slider-knob-start-color: ${buttonColor};
            --paper-slider-pin-color: ${buttonColor};
          }

          .resize-container {
            position:relative;
            display:inline-block;
            cursor:move;
            margin:0 auto;
          }
          .resize-container img { display:block; }
          .resize-container:hover img,
          .resize-container:active img {
            outline: 2px dashed var(--border-subtle-color);
          }

          .parent{
            width:100%;
            height:100%;
            overflow:hidden;
            position:relative;
            flex:1;
          }

          .center{
            position:absolute;
            width:${width};
            height:${height};
            top: calc(50% - ${height}/2);
            left: calc(50% - ${width}/2);
            z-index:2;
            background: color-mix(in srgb, var(--surface-color) 35%, transparent);
            border:2px solid var(--border-strong-color);
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--border-strong-color) 50%, transparent);
          }

          .imageCropped{
            position:relative;
            left:-2px;
            top:-2px;
          }

          .uploader{
            z-index:1;
            position:relative;
            display:none;
          }

          .lb_uploader{
            z-index:1;
            position:relative;
            cursor:pointer;
          }

          .crop,
          .reset {
            display:none;
          }

          .btn{
            z-index:1;
            position:relative;
            font-size:.85rem;
            border:none;
            color:${onButtonColor};
            background:${buttonColor};
            max-height:32px;
            border-radius:999px;
            padding:4px 12px;
            text-transform: none;
            box-shadow: 0 2px 6px rgba(0,0,0,0.18);
          }

          .btn[disabled]{
            opacity:0.7;
            box-shadow:none;
          }
        </style>
        <div id="container">
          <div class="toolbar">
            <label class='lb_uploader' for='uploader'>
              <slot name='select'>
                <paper-button class='btn' toggles raised>
                  <slot name='selectText'>Select</slot>
                </paper-button>
              </slot>
            </label>
            <label class='reset'>
              <slot name='reset'>
                <paper-button class='btn' toggles raised>
                  <slot name='resetText'>Reset</slot>
                </paper-button>
              </slot>
            </label>
            <label class='crop'>
              <slot name='crop'>
                <paper-button class='btn' toggles raised>
                  <slot name='cropText'>Crop</slot>
                </paper-button>
              </slot>
            </label>
            <input type="file" class="uploader" id='uploader'/>
            <div class="slidecontainer">
              <paper-slider id="myRange" class="slider"></paper-slider>
            </div>
          </div>
          <div class='parent'>
            <div class="resize-container">
              <img class="resize-image" src="" style='width:100%'>
            </div>
            <div class='center'><img class="imageCropped"></div>
          </div>
        </div>
        `;
    this.shadowRoot.querySelector('.uploader').addEventListener('change', e => this.loadPic(e));
    this.shadowRoot.querySelector('#myRange').addEventListener('immediate-value-change', e => this.slide(e.target.immediateValue));
    this.shadowRoot.querySelector('.crop').addEventListener('click', () => this.crop());
    this.shadowRoot.querySelector('.reset').addEventListener('click', () => this.reset());

    if (width) {
      this.shadowRoot.querySelector('.center').style.width = width;
      this.shadowRoot.querySelector('.center').style.left = 'calc(50% - ' + width + '/2)';
    }
    if (height) {
      this.shadowRoot.querySelector('.center').style.height = height;
      this.shadowRoot.querySelector('.center').style.top = 'calc(50% - ' + height + '/2)';
    }
    if (rounded) {
      this.shadowRoot.querySelector('.center').style.borderRadius = 'calc(' + height + '/2)';
      this.shadowRoot.querySelector('.imageCropped').style.borderRadius = 'calc(' + height + '/2)';
    }

    if (this.croppedImage != null) {
      this.shadowRoot.querySelector('.imageCropped').src = this.croppedImage;
    }

    this.dragElement(this.shadowRoot.querySelector(".resize-container"));
  }
}

window.customElements.define('globular-image-cropper', ImageCropper);

// ----------------------------------------------------------
// PanZoomCanvas
// ----------------------------------------------------------

function trackTransforms(ctx) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  let xform = svg.createSVGMatrix();
  ctx.getTransform = () => xform;

  const saved = [];
  const save = ctx.save;
  ctx.save = function () {
    saved.push(xform.translate(0, 0));
    return save.call(ctx);
  };

  const restore = ctx.restore;
  ctx.restore = function () {
    xform = saved.pop();
    return restore.call(ctx);
  };

  const scale = ctx.scale;
  ctx.scale = function (sx, sy) {
    xform = xform.scaleNonUniform(sx, sy);
    return scale.call(ctx, sx, sy);
  };

  const rotate = ctx.rotate;
  ctx.rotate = function (rad) {
    xform = xform.rotate((rad * 180) / Math.PI);
    return rotate.call(ctx, rad);
  };

  const translate = ctx.translate;
  ctx.translate = function (dx, dy) {
    xform = xform.translate(dx, dy);
    return translate.call(ctx, dx, dy);
  };

  const transform = ctx.transform;
  ctx.transform = function (a, b, c, d, e, f) {
    const m = svg.createSVGMatrix();
    m.a = a; m.b = b; m.c = c; m.d = d; m.e = e; m.f = f;
    xform = xform.multiply(m);
    return transform.call(ctx, a, b, c, d, e, f);
  };

  const setTransform = ctx.setTransform;
  ctx.setTransform = function (a, b, c, d, e, f) {
    xform.a = a; xform.b = b; xform.c = c; xform.d = d; xform.e = e; xform.f = f;
    return setTransform.call(ctx, a, b, c, d, e, f);
  };

  const pt = svg.createSVGPoint();
  ctx.transformedPoint = function (x, y) {
    pt.x = x;
    pt.y = y;
    return pt.matrixTransform(xform.inverse());
  };
}

export class PanZoomCanvas extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          width:100%;
          height:100%;
          overflow:hidden;
          position:relative;
        }
        canvas {
          width:100%;
          height:100%;
          display:block;
        }
      </style>
      <canvas id="panZoomCanvas"></canvas>
    `;

    /** @type {HTMLCanvasElement} */
    this.canvas = this.shadowRoot.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.image = new Image();
    this._panZoomSetup = false;
  }

  connectedCallback() {
    this._resizeToHost();

    // prepare transform tracking once
    trackTransforms(this.ctx);

    this.image.onload = () => {
      this._resizeToHost();
      this._ensurePanZoom();
      this._fitToView();  // 1x or fit, centered
    };

    if (this.hasAttribute("src")) {
      this.image.src = this.getAttribute("src");
    }

    // Re-fit on container resize to keep ratio correct.
    this._resizeObserver = new ResizeObserver(() => {
      this._resizeToHost();
      if (this.image && this.image.complete) {
        this._fitToView();
      }
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  static get observedAttributes() { return ["src"]; }
  attributeChangedCallback(name, _old, value) {
    if (name === "src") this.image.src = value;
  }

  _resizeToHost() {
    const rect = this.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  _ensurePanZoom() {
    if (this._panZoomSetup) return;
    this._panZoomSetup = true;

    const ctx = this.ctx;
    const canvas = this.canvas;

    this.lastX = canvas.width / 2;
    this.lastY = canvas.height / 2;
    let dragStart = null;

    canvas.addEventListener("mousedown", (evt) => {
      this.lastX = evt.offsetX;
      this.lastY = evt.offsetY;
      dragStart = ctx.transformedPoint(this.lastX, this.lastY);
      this.style.cursor = "grabbing";
    });

    canvas.addEventListener("mousemove", (evt) => {
      this.lastX = evt.offsetX;
      this.lastY = evt.offsetY;

      if (!dragStart) {
        this.style.cursor = "grab";
        return;
      }

      const pt = ctx.transformedPoint(this.lastX, this.lastY);
      ctx.translate(pt.x - dragStart.x, pt.y - dragStart.y);
      this.redraw();
    });

    const stopDrag = () => {
      dragStart = null;
      this.style.cursor = "grab";
    };
    canvas.addEventListener("mouseup", stopDrag);
    canvas.addEventListener("mouseleave", stopDrag);

    canvas.addEventListener("wheel", (evt) => {
      evt.preventDefault();
      const delta = evt.deltaY < 0 ? 1 : -1;
      this.zoom(delta);
    });
  }

  _fitToView() {
    if (!this.image || !this.image.width || !this.image.height) return;

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const iw = this.image.width;
    const ih = this.image.height;

    // 1x if it fits, else downscale; never upscale.
    const naturalZoom = 1;
    const fitZoom = Math.min(cw / iw, ch / ih);
    const zoom = Math.min(naturalZoom, fitZoom);

    const tx = (cw - iw * zoom) / 2;
    const ty = (ch - ih * zoom) / 2;

    ctx.setTransform(zoom, 0, 0, zoom, tx, ty);
    this.redraw();
  }

  zoom(clicks) {
    const scaleFactor = 1.1;
    const ctx = this.ctx;

    const pt = ctx.transformedPoint(this.lastX, this.lastY);
    ctx.translate(pt.x, pt.y);

    const factor = Math.pow(scaleFactor, clicks);
    ctx.scale(factor, factor);

    ctx.translate(-pt.x, -pt.y);
    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    const canvas = this.canvas;

    const p1 = ctx.transformedPoint(0, 0);
    const p2 = ctx.transformedPoint(canvas.width, canvas.height);
    ctx.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

    ctx.drawImage(this.image, 0, 0);
  }
}

customElements.define("globular-pan-zoom-canvas", PanZoomCanvas);


// ----------------------------------------------------------
// ImageViewer
// ----------------------------------------------------------
export class ImageViewer extends HTMLElement {
  constructor() {
    super();
    this.onclose = null;
    this.index = -1;
    const shadowRoot = this.attachShadow({ mode: 'open' });

    shadowRoot.innerHTML = `
    <style>
      ::-webkit-scrollbar { width:5px; height:5px; }
      ::-webkit-scrollbar-track { background: var(--surface-color); }
      ::-webkit-scrollbar-thumb { background: var(--scroll-thumb); }
      ::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }

      .modal {
        z-index:3000;
        display:none;
        position:absolute;
        top:0;
        left:0;
        right:0;
        bottom:0;
        overflow:hidden;
        background-color:rgba(0,0,0,.94);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Arial;
        display:flex;
        justify-content:center;
        align-items:center;
      }

      .container {
        width: min(75vw, 1200px);
        height: min(75vh, 800px);
        background-color: var(--surface-elevated-color);
        border-radius: 12px;
        border:1px solid var(--dialog-border-color);
        box-shadow: var(--dockbar-shadow, 0 18px 45px rgba(0,0,0,0.55));
        padding: 0;
        position:relative;
        overflow:hidden;
        display:flex;
        flex-direction:column;
      }

      #content {
        flex:1;
        position:relative;
        background-color: var(--surface-color);
      }

      globular-pan-zoom-canvas {
        position:absolute;
        inset:0;
        width:100%;
        height:100%;
      }

      #info {
        background-color: var(--primary-color);
        left:88px;
        font-size:14px;
        text-align:center;
        color:var(--on-primary-color);
        margin-top:8px;
        padding:4px 12px;
        border-bottom-right-radius: 10px;
        border-top-right-radius: 0;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      }

      .btn,
      .button {
        border:none;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:6px 12px;
        background-color: color-mix(in srgb, #000 65%, transparent);
        color:var(--on-primary-color);
        cursor:pointer;
        border-radius:999px;
      }

      #leftA, #rightA {
        position:absolute;
        top:50%;
        transform:translateY(-50%);
        font-size:20px;
        background-color: color-mix(in srgb, #000 65%, transparent);
        color:var(--on-primary-color);
        border-radius:999px;
        width:40px;
        height:40px;
        display:flex;
        align-items:center;
        justify-content:center;
        border:1px solid var(--border-subtle-color);
        cursor:pointer;
        user-select:none;
        padding:0;        /* keep glyph centered */
        line-height:1;
      }
      #leftA  { left:12px;  }
      #rightA { right:12px; }

      .display-topright {
        position:absolute;
        right:12px;
        top:10px;
        z-index:100;
        background-color: color-mix(in srgb, #000 65%, transparent);
        color:var(--on-primary-color);
        border-radius:999px;
        width:34px;
        height:34px;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:0;        /* center '×' */
        line-height:1;
        font-size:20px;
      }

      .display-topleft {
        position:absolute;
        left:12px;
        top:10px;
        z-index:100;
        background-color: color-mix(in srgb, #000 65%, transparent);
        color:var(--on-primary-color);
        font-size:13px;
        text-align:center;
        padding:4px 10px;
        border-radius:999px;
      }

      .image {
        max-width:100%;
        height:auto;
        transform-origin:center center;
        transform:scale(1);
        z-index:0;
      }

      iron-icon {
        color:var(--on-primary-color);
        width:24px;
        height:24px;
      }

      @media (max-width:768px){
        .container {
          width:100vw;
          height:100vh;
          border-radius:0;
        }
      }

      #zoomBtns {
        position:absolute;
        top:14px;
        right:56px; /* comfortably inside */
        user-select:none;
        display:flex;
        gap:6px;
        padding:4px 6px;
        border-radius:999px;
        background-color: color-mix(in srgb, #000 65%, transparent);
        border:1px solid var(--border-subtle-color);
      }

      #zoomBtns iron-icon { cursor:pointer; }

      #zoomBtns iron-icon:hover,
      #leftA:hover,
      #rightA:hover,
      .display-topright:hover {
        filter:brightness(1.12);
      }
    </style>
      <div id="imageViewer" class="modal" >
        <paper-icon-button icon="icons:close" id="closeBtn" class="button display-topright"></paper-icon-button>
        <div id="counter" class="display-topleft"></div>
        <div id="info" class="display-topleft btn" style="display:none; left:auto; right:auto;">Description</div>
        <div class="container">
          <div id="content">
            <slot name="images" style="display:none;"><span style="color:white;">No images to show</span></slot>
            <globular-pan-zoom-canvas></globular-pan-zoom-canvas>
            <paper-icon-button icon="icons:chevron-left" id="leftA"  class="button"></paper-icon-button>
            <paper-icon-button icon="icons:chevron-right" id="rightA" class="button"></paper-icon-button>
            <div id="zoomBtns">
              <iron-icon id="zoomInBtn"  class="btn" icon="icons:add"></iron-icon>
              <iron-icon id="zoomOutBtn" class="btn" icon="icons:remove"></iron-icon>
            </div>
          </div>
        </div>
      </div>`;

    if (!this.hasAttribute('closeable')) {
      shadowRoot.querySelector('#closeBtn').style.display = 'none';
      shadowRoot.querySelector("#zoomBtns").style.right = '12px';
    }

    shadowRoot.querySelector('#closeBtn').addEventListener('click', () => {
      this.style.display = 'none';
      if (this.onclose) this.onclose();
    });

    if (this.noinfo) shadowRoot.querySelector('#info').style.display = 'none';

    shadowRoot.querySelector('#rightA').addEventListener('click', () => this.nextImage());
    shadowRoot.querySelector('#leftA').addEventListener('click', () => this.prevImage());

    const imageContainer = shadowRoot.querySelector('#content');
    imageContainer.addEventListener('dragstart', (event) => event.preventDefault());

    shadowRoot.querySelector('#zoomInBtn').addEventListener('click', () => {
      shadowRoot.querySelector('globular-pan-zoom-canvas').zoom(0.6);
    });
    shadowRoot.querySelector('#zoomOutBtn').addEventListener('click', () => {
      shadowRoot.querySelector('globular-pan-zoom-canvas').zoom(-0.6);
    });

    this.observer = new MutationObserver(this.attributeChangedCallback.bind(this));
    this.observer.observe(this, { attributes: true });
  }

  attributeChangedCallback() {
    if (this.hasAttribute('closeable')) {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'block';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '56px';
    } else {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'none';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '12px';
    }
  }

  connectedCallback() {
    if (this.children.length !== 0) {
      const cant = this.children.length;
      for (let i = 0; i < cant; i++) {
        const ch = this.children[i];
        ch.style.maxHeight = '75vh';
        if (this.parentNode.tagName === "BODY") {
          ch.style.maxHeight = 'calc(100vh - 20px)';
        }
      }
      this.populateChildren();
    }

    if (this.hasAttribute('closeable')) {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'block';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '56px';
    } else {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'none';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '12px';
    }
  }

  get noinfo() { return this.hasAttribute('noinfo'); }

  populateChildren() {
    if (this.children.length !== 0) {
      const cant = this.children.length;
      for (let i = 0; i < cant; i++) {
        this.children[i].style.display = (i === 0) ? 'block' : 'none';
        this.children[i].style.margin = 'auto';
        this.children[i].style.maxWidth = '100%';
        this.children[i].style.maxHeight = '75vh';
      }
      this.shadowRoot.querySelector('#counter').innerHTML = '1/' + cant;
      if (this.index === -1) this.index = 0;
      this.activeImage(this.index);
    } else {
      this.shadowRoot.querySelector('#leftA').style.display = 'none';
      this.shadowRoot.querySelector('#rightA').style.display = 'none';
    }
  }

  activeImage(index) {
    const cant = this.children.length;
    for (let i = 0; i < cant; i++) this.children[i].style.display = 'none';
    if (!this.children[index]) return;
    this.children[index].style.display = 'block';
    this.shadowRoot.querySelector('#counter').innerHTML = (index + 1) + '/' + (cant);
    this.index = index;
    this.shadowRoot.querySelector("globular-pan-zoom-canvas")
      .setAttribute("src", this.children[index].getAttribute("src"));
  }

  addImage(e) {
    e.slot = "images";
    this.appendChild(e);
    this.populateChildren();
    this.shadowRoot.querySelector('#leftA').style.display = 'block';
    this.shadowRoot.querySelector('#rightA').style.display = 'block';
  }

  redraw(){}

  loadImgFrom(ele) {
    const imgs = ele.querySelectorAll('img');
    this.style.display = 'block';
    this.innerHTML = '';
    for (let i = 0; i < imgs.length; i++) {
      let src = imgs[i].getAttribute('src');
      const newPic = document.createElement('img');
      newPic.setAttribute('slot', 'images');
      newPic.setAttribute('src', src);
      if (imgs[i].getAttribute('data-info')) {
        newPic.setAttribute('data-info', imgs[i].getAttribute('data-info'));
      }
      this.addImage(newPic);
    }
  }

  infoClick(title, fn) {
    this.shadowRoot.querySelector('#info').innerHTML = title;
    this.shadowRoot.querySelector('#info')
      .addEventListener('click', function func(event) { fn(event); });
  }

  nextImage() {
    const ch = this.children;
    const cant = ch.length;
    let actived, index = 0;
    for (let i = 0; i < cant; i++) {
      if (ch[i].style.display === 'block') {
        actived = (i < cant - 1) ? ch[i + 1] : ch[0];
        index = (i < cant - 1) ? (i + 1) : 0;
      }
      ch[i].style.display = 'none';
    }
    if (actived) {
      actived.style.display = 'block';
      this.shadowRoot.querySelector('#counter').innerHTML = (index + 1) + '/' + (cant);
      this.shadowRoot.querySelector("globular-pan-zoom-canvas")
        .setAttribute("src", ch[index].getAttribute("src"));
    }
  }

  prevImage() {
    const ch = this.children;
    const cant = ch.length;
    let actived, index = cant - 1;
    for (let i = 0; i < cant; i++) {
      if (ch[i].style.display === 'block') {
        actived = (i > 0) ? ch[i - 1] : ch[cant - 1];
        index = (i > 0) ? (i - 1) : (cant - 1);
      }
      ch[i].style.display = 'none';
    }
    if (actived) {
      actived.style.display = 'block';
      this.shadowRoot.querySelector('#counter').innerHTML = (index + 1) + '/' + (cant);
      this.shadowRoot.querySelector("globular-pan-zoom-canvas")
        .setAttribute("src", ch[index].getAttribute("src"));
    }
  }
}
window.customElements.define('globular-image-viewer', ImageViewer);


// ----------------------------------------------------------
// ImageSelector (globule-free; uses file backend helpers)
// ----------------------------------------------------------
export class ImageSelector extends HTMLElement {
  constructor(label, url) {
    super();
    this.attachShadow({ mode: 'open' });

    if (this.hasAttribute("label")) label = this.getAttribute("label");
    if (!label) label = "";

    if (this.hasAttribute("url")) url = this.getAttribute("url");
    if (!url) url = "";

    this.imageUrl = url;

    this.shadowRoot.innerHTML = `
      <style>
        #container{
          color: var(--on-surface-color);
          font-size:0.9rem;
          display:flex;
          flex-direction:column;
          gap:4px;
        }

        #label{
          opacity:0.9;
        }

        .image-selector{
          max-width:200px;
          position:relative;
          border-radius:8px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.12);
        }

        #delete-cover-image-btn {
          ${url.length == 0 ? "display:none;" : "display:flex;"}
          z-index:100;
          position:absolute;
          top:-10px;
          left:-16px;
          background-color: color-mix(in srgb, #000 70%, transparent);
          --paper-icon-button-ink-color:white;
          --iron-icon-fill-color:white;
          border-bottom:1px solid var(--palette-divider);
          border-right:1px solid var(--palette-divider);
          padding:4px;
          width:30px;
          height:30px;
          --iron-icon-width:20px;
          --iron-icon-height:20px;
          border-radius:999px;
          align-items:center;
          justify-content:center;
        }

        #drop-zone{
          min-width:180px;
          transition: background .15s ease, padding .15s linear, filter .15s ease;
          background-color: var(--surface-color);
          position:relative;
          border:2px dashed var(--border-subtle-color);
          border-radius:10px;
          min-height:120px;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:5px;
        }
        #drop-zone.drag-over {
          background-color: color-mix(in srgb, var(--surface-color) 90%, var(--primary-color) 10%);
          border-color: var(--primary-color);
          filter:brightness(1.02);
        }
      </style>
      <div id="container">
        <span id="label">${label}</span>
        <div id="drop-zone">
          <div style="position:relative; display:flex;">
            <paper-icon-button id="delete-cover-image-btn" icon="icons:close"></paper-icon-button>
            <img class="image-selector" src="${this.imageUrl}"> </img>  
          </div>
        </div>
      </div>
    `;

    this.image = this.shadowRoot.querySelector(".image-selector");
    this.deleteBtn = this.shadowRoot.querySelector("#delete-cover-image-btn");

    this.shadowRoot.querySelector("#delete-cover-image-btn").onclick = () => {
      const toast = displayMessage(
        `
        <style>
          #yes-no-picture-delete-box{ display:flex; flex-direction:column; }
          #yes-no-picture-delete-box div{ display:flex; padding-bottom:10px; }
          paper-button{ font-size:.8rem; }
        </style>
        <div id="yes-no-picture-delete-box">
          <div>You're about to remove ${label} image</div>
          <img style="max-height:256px; object-fit:contain; width:100%;" src="${this.imageUrl}"></img>
          <div>Is it what you want to do?</div>
          <div style="justify-content:flex-end;">
            <paper-button raised id="yes-delete-picture">Yes</paper-button>
            <paper-button raised id="no-delete-picture">No</paper-button>
          </div>
        </div>
        `,
        60 * 1000
      );

      const yesBtn = document.querySelector("#yes-delete-picture");
      const noBtn = document.querySelector("#no-delete-picture");

      yesBtn.onclick = () => {
        if (this.ondelete) this.ondelete();
        this.image.removeAttribute("src");
        this.deleteBtn.style.display = "none";
        toast.hideToast();
      };
      noBtn.onclick = () => toast.hideToast();
    };

    const imageCoverDropZone = this.shadowRoot.querySelector("#drop-zone");

    imageCoverDropZone.ondragenter = (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      imageCoverDropZone.classList.add("drag-over");
    };
    imageCoverDropZone.ondragleave = (evt) => {
      evt.preventDefault();
      imageCoverDropZone.classList.remove("drag-over");
    };
    imageCoverDropZone.ondragover   = (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
    };

    // ✅ updated: when files are dropped from your file-explorer, use new backend helpers
    imageCoverDropZone.ondrop = async (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      imageCoverDropZone.classList.remove("drag-over");

      if (evt.dataTransfer.files.length > 0) {
        // Local file from desktop
        const file = evt.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          this.deleteBtn.style.display = "flex";
          this.imageUrl = dataUrl;
          this.image.src = dataUrl;
          if (this.onselectimage) this.onselectimage(dataUrl);
        };
        reader.readAsDataURL(file);
        return;
      }

      // Drop payload from your app's file-explorer
      const pathsJson = evt.dataTransfer.getData('files');
      const domain = evt.dataTransfer.getData('domain') || undefined;

      if (!pathsJson) return;
      let paths = [];
      try { paths = JSON.parse(pathsJson); } catch { paths = []; }
      if (!Array.isArray(paths) || paths.length === 0) return;

      for (const path of paths) {
        try {
          // Optional meta fetch
          // await getFileMeta(path, domain);

          // Build a signed/authorized URL for preview (no globule)
          const url = await buildFileUrl(path, { domain, purpose: 'preview' }); // adjust args if your helper differs

          createThumbmail(url, 500, (dataUrl) => {
            this.deleteBtn.style.display = "flex";
            this.image.src = dataUrl;
            this.imageUrl = dataUrl;
            if (this.onselectimage) this.onselectimage(dataUrl);
          });
        } catch (err) {
          displayError(err?.message || String(err), 3000);
        }
      }
    };
  }

  setImageUrl(url) {
    this.image.src = url;
    this.deleteBtn.style.display = url && url.length > 0 ? "flex" : "none";
  }

  getImageUrl() {
    return this.image.src;
  }

  createMosaic(images, callback) {
    const grid = document.createElement("div");
    grid.classList.add("grid");
    grid.setAttribute("data-masonry", '{ "itemSelector": ".grid-item", "columnWidth": 50 }');
    if (images.length > 3) grid.style.width = "300px";
    grid.style.backgroundColor = "black";

    images.forEach((img, idx) => {
      if (idx < 9) {
        img.classList.add("grid-item");
        img.style.maxWidth = "100px";
        img.style.maxHeight = "100px";
        grid.appendChild(img);
      }
    });

    const toast = displayMessage(
      `
      <div style="display:flex; flex-direction:column;">
        <div>Generate cover from content...</div>
        <div id="grid-div" style="background-color:black; min-height:300px; margin-top:20px;"></div>
      </div>
      `, 3000);

    toast.toastElement.querySelector("#grid-div").appendChild(grid);
    fireResize();

    setTimeout(() => {
      domtoimage.toJpeg(grid, { quality: 0.95 })
        .then((dataUrl) => {
          this.image.src = dataUrl;
          callback(dataUrl);
        });
    }, 1000);
  }
}
customElements.define('globular-image-selector', ImageSelector);

// ----------------------------------------------------------
// ImageGallery (no globule; themed)
// ----------------------------------------------------------
export class ImageGallery extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
        <style>
        *,*::before,*::after {
          margin:0;
          padding:0;
          outline:none;
          box-sizing:border-box;
        }

        .container {
          margin:0 auto;
          max-width:700px;
          max-height:100vh;
          background-color: var(--surface-elevated-color);
          border-radius: 12px;
          border:1px solid var(--border-subtle-color);
          box-shadow: var(--dockbar-shadow, 0 8px 22px rgba(0,0,0,0.35));
          overflow:hidden;
        }

        .xy-center { position:absolute; top:50%; left:50%; transform: translate(-50%, -50%); }
        .transition { transition: all 350ms ease-in-out; }

        .r-3-2 {
          width:100%;
          padding-bottom:66.667%;
          background-color: var(--surface-color);
        }

        .image-holder {
          background-position:center center;
          background-repeat:no-repeat;
          background-size:contain;
        }

        .gallery-wrapper {
          position:relative;
          overflow:hidden;
          background-color: var(--surface-color);
        }

        .gallery {
          position:relative;
          white-space:nowrap;
          font-size:0;
        }

        .item-wrapper {
          cursor:pointer;
          width:23%;
          display:inline-block;
          background-color:var(--surface-color);
        }

        .gallery-item {
          opacity:.5;
        }
        .gallery-item.active {
          opacity:1;
        }

        .controls {
          font-size:0;
          border-top:1px solid var(--border-subtle-color);
          background-color: var(--surface-color);
        }

        .move-btn {
          display:inline-block;
          width:50%;
          border:none;
          color:var(--on-surface-color);
          background:transparent;
          padding:.4em 1.5em;
          font-size:0.85rem;
          cursor:pointer;
          user-select:none;
        }

        .move-btn.left  { text-align:left; }
        .move-btn.right { text-align:right; }

        #leftA, #rightA {
          font-size:16px;
          color:var(--on-surface-color);
        }

        .feature{
          position:relative;
          background-color: var(--surface-color);
        }

        paper-icon-button {
          position:absolute;
          top:0;
          left:0;
          background: color-mix(in srgb, #000 65%, transparent);
          height:30px;
          width:30px;
          --iron-icon-width:20px;
          --iron-icon-height:20px;
          border-bottom:1px solid var(--palette-divider);
          border-right:1px solid var(--palette-divider);
          border-radius:0 0 6px 0;
          --iron-icon-fill-color:white;
        }

        globular-image-viewer {
          position:fixed;
          top:0;
          bottom:0;
          left:0;
          right:0;
        }

        #close-btn{
          --paper-icon-button-ink-color:white;
        }
        </style>
        <div class="container">
          <div class="feature">
            <figure class="featured-item image-holder r-3-2 transition"></figure>
            <paper-icon-button id="close-btn" style="display:none;" icon="icons:close"></paper-icon-button>
          </div>
          <div class="gallery-wrapper"><div class="gallery"></div></div>
          <div class="controls">
            <div id='leftA' class="move-btn left'>❮</div>
            <div id='rightA' class="move-btn right'>❯</div>
          </div>
        </div>
        <slot style="display:none;"></slot>
        `;

    this.gallery = this.shadowRoot.querySelector('.gallery');
    this.itemWidth = 23; // %
    this.leftBtn = this.shadowRoot.querySelector('.move-btn.left');
    this.rightBtn = this.shadowRoot.querySelector('.move-btn.right');

    this.leftInterval = undefined;
    this.rightInterval = undefined;
    this.scrollRate = 0.2;
    this.left = undefined;
    this.images = [];

    this.leftBtn.ontouchstart = this.leftBtn.onmouseenter = (e) => this.moveLeft(e);
    this.leftBtn.ontouchend   = this.leftBtn.onmouseleave = (e) => this.stopMovement(e);
    this.rightBtn.ontouchstart = this.rightBtn.onmouseenter = (e) => this.moveRight(e);
    this.rightBtn.ontouchend   = this.rightBtn.onmouseleave = (e) => this.stopMovement(e);

    this.closeBtn = this.shadowRoot.querySelector("#close-btn");
    this.closeBtn.onclick = () => {
      const url = new URL(this.featured().image.src);
      const toast = displayMessage(
        `
        <style>
          #yes-no-picture-delete-box{ display:flex; flex-direction:column; }
          #yes-no-picture-delete-box div{ display:flex; padding-bottom:10px; }
          paper-button{ font-size:.8rem; }
        </style>
        <div id="yes-no-picture-delete-box">
          <div>You're about to remove image from the gallery</div>
          <img style="max-height:256px; object-fit:contain; width:100%;" src="${this.featured().image.src}"></img>
          <span style="font-size:.75rem;">${decodeURIComponent(url.pathname)}</span>
          <div>Is it what you want to do?</div>
          <div style="justify-content:flex-end;">
            <paper-button raised id="yes-delete-picture">Yes</paper-button>
            <paper-button raised id="no-delete-picture">No</paper-button>
          </div>
        </div>
        `,
        60 * 1000
      );

      const yesBtn = document.querySelector("#yes-delete-picture");
      const noBtn = document.querySelector("#no-delete-picture");

      yesBtn.onclick = () => {
        this.images = this.images.filter(e => e !== this.featured().image.src);
        toast.hideToast();
        displayMessage(
          `<div style="display:flex; flex-direction:column;">
             <span style="font-size:.85rem;">${url.pathname}</span>
             <span>was removed from the gallery</span>
           </div>`,
          3000
        );
        this.setImages(this.images);
        if (this.onremoveimage) this.onremoveimage(decodeURIComponent(url.pathname));
      };
      noBtn.onclick = () => toast.hideToast();
    };
  }

  connectedCallback() {
    const images = [];
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      if (child.tagName === "IMG") images.push(child.src);
    }
    this.setImages(images);
  }

  setEditable(editable) {
    this.closeBtn.style.display = editable ? "block" : "none";
  }

  getImage(index) { return this.images[index]; }

  setImages(images) {
    this.images = images;

    const controls = this.shadowRoot.querySelector(".controls");
    controls.style.display = (this.images.length > 1) ? "block" : "none";

    this.imageViewer = new ImageViewer();
    this.imageViewer.style.position = "fixed";
    this.imageViewer.style.top = "0";
    this.imageViewer.style.left = "0";
    this.imageViewer.style.right = "0";
    this.imageViewer.style.bottom = "0";
    this.imageViewer.setAttribute("closeable", true);
    this.imageViewer.onclose = () => { this.imageViewer.parentNode.removeChild(this.imageViewer); };

    this.featured().onclick = () => {
      this.imageViewer.activeImage(this.featured().index);
      this.imageViewer.style.display = "block";
      document.body.appendChild(this.imageViewer);
    };

    this.gallery.innerHTML = "";
    const range = document.createRange();

    for (let i = 0; i < images.length; i++) {
      const html = `
        <div class="item-wrapper">
          <figure class="gallery-item image-holder r-3-2 transition"></figure>
        </div>`;
      this.gallery.appendChild(range.createContextualFragment(html));
      const galleryItem = this.gallery.children[this.gallery.children.length - 1];

      const img = document.createElement("img");
      img.src = images[i];
      this.imageViewer.addImage(img);

      galleryItem.children[0].style.backgroundImage = 'url(' + img.src + ')';
      const index = i;

      galleryItem.children[0].onclick = (e) => {
        if (e.target.classList.contains('active')) return;
        this.featured().style.backgroundImage = e.target.style.backgroundImage;
        this.featured().index = index;
        this.featured().image = img;
        this.imageViewer.activeImage(index);
        for (let j = 0; j < this.galleryItems().length; j++) {
          if (this.galleryItems()[j].classList.contains('active')) this.galleryItems()[j].classList.remove('active');
        }
        e.target.classList.add('active');
      };

      if (i === 0) {
        galleryItem.children[0].classList.add('active');
        this.featured().index = index;
        this.featured().style.backgroundImage = 'url(' + img.src + ')';
        this.featured().image = img;
      }
    }
  }

  getImages() {
    return this.images.map(src => {
      const img = document.createElement("img");
      img.src = src;
      return img;
    });
  }

  featured() { return this.shadowRoot.querySelector('.featured-item'); }
  numOfItems() { return this.gallery.children.length; }
  galleryItems() { return this.shadowRoot.querySelectorAll('.gallery-item'); }

  galleryWrapLeft() {
    const first = this.gallery.children[0];
    this.gallery.removeChild(first);
    this.gallery.style.left = -this.itemWidth + '%';
    this.gallery.appendChild(first);
    this.gallery.style.left = '0%';
  }

  galleryWrapRight() {
    const last = this.gallery.children[this.gallery.children.length - 1];
    this.gallery.removeChild(last);
    this.gallery.insertBefore(last, this.gallery.children[0]);
    this.gallery.style.left = '-23%';
  }

  moveLeft() {
    this.left = this.left || 0;
    this.leftInterval = setInterval(() => {
      this.gallery.style.left = this.left + '%';
      if (this.left > - this.itemWidth) this.left -= this.scrollRate;
      else { this.left = 0; this.galleryWrapLeft(); }
    }, 9);
  }

  moveRight() {
    if (this.left > -this.itemWidth && this.left < 0) {
      this.left = this.left - this.itemWidth;
      const last = this.gallery.children[this.gallery.children.length - 1];
      this.gallery.removeChild(last);
      this.gallery.style.left = this.left + '%';
      this.gallery.insertBefore(last, this.gallery.children[0]);
    }

    this.left = this.left || 0;
    this.leftInterval = setInterval(() => {
      this.gallery.style.left = this.left + '%';
      if (this.left < 0) {
        this.left += this.scrollRate;
      } else {
        this.left = -this.itemWidth;
        this.galleryWrapRight();
      }
    }, 9);
  }

  stopMovement() {
    clearInterval(this.leftInterval);
    clearInterval(this.rightInterval);
  }
}
customElements.define('globular-image-gallery', ImageGallery);
