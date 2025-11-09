import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-slider/paper-slider.js';

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
        this.shadowRoot.querySelector('.crop').style.display = 'initial';

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
    this.shadowRoot.querySelector('.reset').style.display = 'initial';
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
    let backgroundColor = this.getAttribute('background-color') || 'var(--surface-color)';
    let onBackgroundColor = this.getAttribute('on-background-color') || 'var(--on-surface-color)';
    let buttonColor = this.getAttribute('button-color') || 'var(--secondary-color)';
    let onButtonColor = this.getAttribute('on-button-color') || 'var(--on-secondary-color)';

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
          }
          .slidecontainer { width: 100%; display:none; z-index: 1; margin-top:8px; }
          .slider { -webkit-appearance:none; width:100%; height:15px; border-radius:5px; background:#d3d3d3; outline:none; opacity:.9; transition: opacity .2s; }
          .slider:hover { opacity:1; }
          .slider::-webkit-slider-thumb { -webkit-appearance:none; width:25px; height:25px; border-radius:50%; background:#2196F3; cursor:pointer; }
          .slider::-moz-range-thumb { width:25px; height:25px; border-radius:50%; background:#2196F3; cursor:pointer; border:none; }
          .resize-container { position:relative; display:inline-block; cursor:move; margin:0 auto; }
          .resize-container img { display:block; }
          .resize-container:hover img, .resize-container:active img { outline: 2px dashed gray; }
          .parent{ width:99%; height:99%; overflow:hidden; position:absolute; top:0; left:0; }
          .center{ position:absolute; width:${width}; height:${height}; top: calc(50% - ${width}/2); left: calc(50% - ${height}/2); z-index:2; background: rgba(255,255,255,.3); border:2px solid #cecece; }
          .imageCropped{ position:relative; left:-2px; top:-2px; }
          .uploader{ z-index:1; position:relative; display:none; }
          .lb_uploader{ z-index:1; position:relative; cursor:pointer; }
          .crop, .reset { display:none; }
          .btn{ z-index:1; position:relative; font-size:.85rem; border:none; color:${onButtonColor}; background:${buttonColor}; max-height:32px; }
        </style>
        <div id="container">
          <div style="display:flex; padding-top:5px; padding-right:4px;">
            <label class='lb_uploader' for='uploader'>
              <slot name='select'>
                <paper-button class='btn' toggles raised ><slot name='selectText'>Select</slot></paper-button>
              </slot>
            </label>
            <label class='reset'>
              <slot name='reset'>
                <paper-button class='btn' toggles raised ><slot name='resetText'>Reset</slot></paper-button>
              </slot>
            </label>
            <label class='crop'>
              <slot name='crop'>
                <paper-button class='btn' toggles raised ><slot name='cropText'>Crop</slot></paper-button>
              </slot>
            </label>
            <input type="file" class="uploader" id='uploader'/>
            <div class="slidecontainer">
              <paper-slider id="myRange" class="slider"> </paper-slider>
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
// PanZoomCanvas (unchanged except for cleanup)
// ----------------------------------------------------------

function trackTransforms(ctx) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
  let xform = svg.createSVGMatrix();
  ctx.getTransform = function () { return xform; };

  const savedTransforms = [];
  const save = ctx.save;
  ctx.save = function () { savedTransforms.push(xform.translate(0, 0)); return save.call(ctx); };

  const restore = ctx.restore;
  ctx.restore = function () { xform = savedTransforms.pop(); return restore.call(ctx); };

  const scale = ctx.scale;
  ctx.scale = function (sx, sy) { xform = xform.scaleNonUniform(sx, sy); return scale.call(ctx, sx, sy); };

  const rotate = ctx.rotate;
  ctx.rotate = function (radians) { xform = xform.rotate(radians * 180 / Math.PI); return rotate.call(ctx, radians); };

  const translate = ctx.translate;
  ctx.translate = function (dx, dy) { xform = xform.translate(dx, dy); return translate.call(ctx, dx, dy); };

  const transform = ctx.transform;
  ctx.transform = function (a, b, c, d, e, f) {
    const m2 = svg.createSVGMatrix(); m2.a=a; m2.b=b; m2.c=c; m2.d=d; m2.e=e; m2.f=f;
    xform = xform.multiply(m2);
    return transform.call(ctx, a, b, c, d, e, f);
  };

  const setTransform = ctx.setTransform;
  ctx.setTransform = function (a, b, c, d, e, f) {
    xform.a=a; xform.b=b; xform.c=c; xform.d=d; xform.e=e; xform.f=f;
    return setTransform.call(ctx, a, b, c, d, e, f);
  };

  const pt = svg.createSVGPoint();
  ctx.transformedPoint = function (x, y) { pt.x = x; pt.y = y; return pt.matrixTransform(xform.inverse()); }
}

export class PanZoomCanvas extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
          <style>
              :host { display:block; position:relative; width:100%; height:100%; overflow:hidden; }
              canvas { display:block; width:100%; height:100%; }
          </style>
          <canvas id="panZoomCanvas"></canvas>
      `;
    this.canvas = this.shadowRoot.getElementById('panZoomCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.image = new Image();
  }

  connectedCallback() {
    this.canvas.width = this.getAttribute('width') || window.innerWidth;
    this.canvas.height = this.getAttribute('height') || window.innerHeight;

    this.image.onload = () => {
      this.setupPanZoom();

      if (this.canvas.width == 0 || this.canvas.height == 0) {
        this.canvas.width = this.image.width;
        this.canvas.height = this.image.height;
      }
      const fitScaleX = this.canvas.width / this.image.width;
      const fitScaleY = this.canvas.height / this.image.height;
      const initialZoom = Math.min(fitScaleX, fitScaleY);
      const initialTranslationX = (this.canvas.width - this.image.width * initialZoom) / 2;
      const initialTranslationY = (this.canvas.height - this.image.height * initialZoom) / 2;

      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(initialZoom, 0, 0, initialZoom, initialTranslationX, initialTranslationY);
      this.redraw();
    };

    this.image.src = this.getAttribute('src');
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === 'src') this.image.src = newValue;
  }

  static get observedAttributes() { return ['src']; }

  setupPanZoom() {
    const canvas = this.shadowRoot.getElementById('panZoomCanvas');
    const ctx = this.canvas.getContext('2d');
    trackTransforms(ctx);

    this.lastX = canvas.width / 2; this.lastY = canvas.height / 2;
    let dragStart, dragged;

    canvas.addEventListener('mousedown', (evt) => {
      document.body.style.userSelect = 'none';
      this.lastX = evt.offsetX || (evt.pageX - canvas.offsetLeft);
      this.lastY = evt.offsetY || (evt.pageY - canvas.offsetTop);
      dragStart = ctx.transformedPoint(this.lastX, this.lastY);
      this.style.cursor = 'grabbing';
      dragged = false;
    }, false);

    canvas.addEventListener('mousemove', (evt) => {
      this.lastX = evt.offsetX || (evt.pageX - canvas.offsetLeft);
      this.lastY = evt.offsetY || (evt.pageY - canvas.offsetTop);
      dragged = true;
      if (dragStart) {
        const pt = ctx.transformedPoint(this.lastX, this.lastY);
        ctx.translate(pt.x - dragStart.x, pt.y - dragStart.y);
        this.style.cursor = 'move';
        this.redraw();
      } else {
        this.style.cursor = 'grab';
      }
    }, false);

    canvas.addEventListener('mouseup', () => {
      dragStart = null;
      this.style.cursor = 'grab';
    }, false);

    const handleScroll = (evt) => {
      const delta = evt.wheelDelta ? evt.wheelDelta / 200 : evt.detail ? -evt.detail : 0;
      if (delta) this.zoom(delta);
      evt.preventDefault();
      return false;
    };

    canvas.addEventListener('DOMMouseScroll', handleScroll, false);
    canvas.addEventListener('mousewheel', handleScroll, false);
  }

  zoom(clicks) {
    const scaleFactor = 1.1;
    const ctx = this.canvas.getContext('2d');
    const pt = ctx.transformedPoint(this.lastX, this.lastY);
    ctx.translate(pt.x, pt.y);
    const factor = Math.pow(scaleFactor, clicks);
    ctx.scale(factor, factor);
    ctx.translate(-pt.x, -pt.y);
    this.redraw();
  }

  redraw() {
    const canvas = this.shadowRoot.getElementById('panZoomCanvas');
    const ctx = this.canvas.getContext('2d');
    const p1 = ctx.transformedPoint(0, 0);
    const p2 = ctx.transformedPoint(canvas.width, canvas.height);
    ctx.clearRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.drawImage(this.image, 0, 0);
  }
}
customElements.define('globular-pan-zoom-canvas', PanZoomCanvas);

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
        ::-webkit-scrollbar-thumb { background: var(--palette-divider); }
        .modal { z-index:3000; display:none; position:absolute; left:0; top:0; width:100%; height:100%;
                 overflow:auto; background-color:rgba(0,0,0,.94); font-family: Verdana,sans-serif;
                 display:flex; justify-content:center; align-items:center; }
        #info { background-color:#2196F3; left:88px; font-size:18px; text-align:center; color:white;
                margin-top:8px; padding:5px 16px; }
        #leftA, #rightA { position:absolute; top:53%; transform:translate(0%,-53%); font-size:30px;
                          background-color:#3e3c3c99; color:white; }
        #leftA { left:0; } #rightA { right:0; }
        .btn, .button { border:none; display:inline-block; padding:8px 16px; background-color:#3e3c3c99; color:white; cursor:pointer; }
        .display-topright { background-color:#3e3c3c99; color:white; position:absolute; right:0; top:0; z-index:100; }
        .display-topleft { background-color:#3e3c3c99; color:white; z-index:100; position:absolute; left:0; top:0; font-size:25px; text-align:center; padding:4px 16px; }
        .container { padding:0.01em 16px; overflow:hidden; }
        .image { max-width:100%; height:auto; transform-origin:center center; transform:scale(1); z-index:0; }
        iron-icon { color:white; width:32px; height:32px; }
        @media (max-width:768px){ .modal{ padding-top:50px; } }
        #zoomBtns { position:absolute; top:15px; right:100px; user-select:none; }
        iron-icon:hover { cursor:pointer; }
      </style>
      <div id="imageViewer" class="modal" >
        <span id='closeBtn' class="button display-topright" style='color:white;font-size:30px;'>×</span>
        <div id='counter' class='display-topleft' ></div>
        <div id='info' class='display-topleft btn' style="display:none;">Description</div>
        <div class="container" id="imageContainer">
          <div id="content">
            <slot name='images' style="display:none;"><span style='color:white;'>No images to show</span></slot>
            <globular-pan-zoom-canvas height="600" width="800"></globular-pan-zoom-canvas>
          </div>
          <div id='leftA' class="button">❮</div>
          <div id='rightA' class="button">❯</div>
          <div id='zoomBtns'>
            <iron-icon id='zoomInBtn' class="btn" icon="icons:add"></iron-icon>
            <iron-icon id='zoomOutBtn' class="btn" icon="icons:remove"></iron-icon>
          </div>
        </div>
      </div>`;

    if (!this.hasAttribute('closeable')) {
      shadowRoot.querySelector('#closeBtn').style.display = 'none';
      shadowRoot.querySelector("#zoomBtns").style.right = '10px';
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
      this.shadowRoot.querySelector("#zoomBtns").style.right = '100px';
    } else {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'none';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '10px';
    }
  }

  connectedCallback() {
    const imageContainer = this.shadowRoot.querySelector('#imageViewer');
    this.shadowRoot.querySelector("globular-pan-zoom-canvas").setAttribute("height", imageContainer.offsetHeight * .88);
    this.shadowRoot.querySelector("globular-pan-zoom-canvas").setAttribute("width", imageContainer.offsetWidth * .88);

    if (this.children.length != 0) {
      for (let i = 0; i < this.children.length; i++) {
        const ch = this.children[i];
        ch.style.maxHeight = '75vh';
        if (this.parentNode.tagName == "BODY") ch.style.maxHeight = 'calc(100vh - 20px)';
      }
      this.populateChildren();
    }

    if (this.hasAttribute('closeable')) {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'block';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '100px';
    } else {
      this.shadowRoot.querySelector('#closeBtn').style.display = 'none';
      this.shadowRoot.querySelector("#zoomBtns").style.right = '10px';
    }
  }

  get noinfo() { return this.hasAttribute('noinfo'); }

  populateChildren() {
    if (this.children.length != 0) {
      const cant = this.children.length;
      for (let i = 0; i < cant; i++) {
        this.children[i].style.display = (i === 0) ? 'block' : 'none';
        this.children[i].style.margin = 'auto';
        this.children[i].style.maxWidth = '100%';
        this.children[i].style.maxHeight = '75vh';
      }
      this.shadowRoot.querySelector('#counter').innerHTML = '1/' + cant;
      if (this.index == -1) this.index = 0;
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
    this.shadowRoot.querySelector("globular-pan-zoom-canvas").setAttribute("src", this.children[index].getAttribute("src"));
  }

  addImage(e) {
    e.slot = "images";
    this.appendChild(e);
    this.populateChildren();
    this.shadowRoot.querySelector('#leftA').style.display = 'block';
    this.shadowRoot.querySelector('#rightA').style.display = 'block';
  }

  redraw(){}

  // ✅ updated: no globule; URLs should already be usable/signed upstream.
  loadImgFrom(ele) {
    const imgs = ele.querySelectorAll('img');
    this.style.display = 'block';
    this.innerHTML = '';
    for (let i = 0; i < imgs.length; i++) {
      let src = imgs[i].getAttribute('src');
      const newPic = document.createElement('img');
      newPic.setAttribute('slot', 'images');
      newPic.setAttribute('src', src);
      if (imgs[i].getAttribute('data-info')) newPic.setAttribute('data-info', imgs[i].getAttribute('data-info'));
      this.addImage(newPic);
    }
  }

  infoClick(title, fn) {
    this.shadowRoot.querySelector('#info').innerHTML = title;
    this.shadowRoot.querySelector('#info').addEventListener('click', function func(event) { fn(event); });
  }

  nextImage() {
    const ch = this.children;
    const cant = ch.length;
    let actived, index = 0;
    for (let i = 0; i < cant; i++) {
      if (ch[i].style.display == 'block') {
        actived = (i < cant - 1) ? ch[i + 1] : ch[0];
        index = (i < cant - 1) ? (i + 1) : 0;
      }
      ch[i].style.display = 'none';
    }
    if (actived) {
      actived.style.display = 'block';
      this.shadowRoot.querySelector('#counter').innerHTML = (index + 1) + '/' + (cant);
      this.shadowRoot.querySelector("globular-pan-zoom-canvas").setAttribute("src", ch[index].getAttribute("src"));
    }
  }

  prevImage() {
    const ch = this.children;
    const cant = ch.length;
    let actived, index = cant - 1;
    for (let i = 0; i < cant; i++) {
      if (ch[i].style.display == 'block') {
        actived = (i > 0) ? ch[i - 1] : ch[cant - 1];
        index = (i > 0) ? (i - 1) : (cant - 1);
      }
      ch[i].style.display = 'none';
    }
    if (actived) {
      actived.style.display = 'block';
      this.shadowRoot.querySelector('#counter').innerHTML = (index + 1) + '/' + (cant);
      this.shadowRoot.querySelector("globular-pan-zoom-canvas").setAttribute("src", ch[index].getAttribute("src"));
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
        #container{ color: var(--primary-text-color); }
        .image-selector{ max-width:200px; position:relative; }
        #delete-cover-image-btn {
          ${url.length == 0 ? "display:none;" : "display:block;"}
          z-index:100; position:absolute; top:-10px; left:-16px; background-color:black;
          --paper-icon-button-ink-color:white; --iron-icon-fill-color:white;
          border-bottom:1px solid var(--palette-divider); border-right:1px solid var(--palette-divider);
          padding:4px; width:30px; height:30px; --iron-icon-width:24px; --iron-icon-height:24px;
        }
        #drop-zone{
          min-width:180px; transition: background .2s ease,padding .8s linear;
          background-color: var(--surface-color);
          position:relative; border:2px dashed var(--palette-divider); border-radius:5px;
          min-height:120px; display:flex; align-items:center; justify-content:center; padding:5px;
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
          <div>Your about to remove ${label} image</div>
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

    imageCoverDropZone.ondragenter = (evt) => { evt.stopPropagation(); evt.preventDefault(); imageCoverDropZone.style.filter = "invert(10%)"; };
    imageCoverDropZone.ondragleave = (evt) => { evt.preventDefault(); imageCoverDropZone.style.filter = ""; };
    imageCoverDropZone.ondragover   = (evt) => { evt.stopPropagation(); evt.preventDefault(); };

    // ✅ updated: when files are dropped from your file-explorer, use new backend helpers
    imageCoverDropZone.ondrop = async (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      imageCoverDropZone.style.filter = "";

      if (evt.dataTransfer.files.length > 0) {
        // Local file from desktop
        const file = evt.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          this.deleteBtn.style.display = "block";
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
          // Optional: fetch metadata (not strictly required for thumbnail)
          // await getFileMeta(path, domain);

          // Build a signed/authorized URL for preview (no globule)
          const url = await buildFileUrl(path, { domain, purpose: 'preview' }); // adjust args if your helper differs

          createThumbmail(url, 500, (dataUrl) => {
            this.deleteBtn.style.display = "block";
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
    this.deleteBtn.style.display = url && url.length > 0 ? "block" : "none";
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
// ImageGallery (no globule; unchanged logic)
// ----------------------------------------------------------
export class ImageGallery extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
        <style>
        *,*::before,*::after { margin:0; padding:0; outline:none; box-sizing:border-box; }
        .container { margin:0 auto; max-width:700px; max-height:100vh; background-color:white; }
        .xy-center { position:absolute; top:50%; left:50%; transform: translate(-50%, -50%); }
        .transition { transition: all 350ms ease-in-out; }
        .r-3-2 { width:100%; padding-bottom:66.667%; background-color:#ddd; }
        .image-holder { background-position:center center; background-repeat:no-repeat; background-size:auto 100%; }
        .gallery-wrapper { position:relative; overflow:hidden; }
        .gallery { position:relative; white-space:nowrap; font-size:0; }
        .item-wrapper { cursor:pointer; width:23%; display:inline-block; background-color:white; }
        .gallery-item { opacity:.5; } .gallery-item.active { opacity:1; }
        .controls { font-size:0; border-top:none; }
        .move-btn { display:inline-block; width:50%; border:none; color:#ccc; background:transparent; padding:.2em 1.5em; }
        .move-btn.left  { cursor:w-resize; } .move-btn.right { cursor:e-resize; }
        #leftA, #rightA { font-size:16px; background:#3e3c3c99; color:white; }
        #leftA { text-align:left; } #rightA { text-align:right; }
        .feature{ position:relative; }
        paper-icon-button { position:absolute; top:0; left:0; background:black; height:25px; width:25px; }
        globular-image-viewer { position:fixed; top:0; bottom:0; left:0; right:0; }
        #close-btn{ position:absolute; top:0; left:0; background:black;
                    --paper-icon-button-ink-color:white; --iron-icon-fill-color:white;
                    border-bottom:1px solid var(--palette-divider); border-right:1px solid var(--palette-divider); }
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
          <div>Your about to remove image from the gallery</div>
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
             <span>was remove from the gallery</span>
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
    } }
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
      if (this.left < 0) this.left += this.scrollRate;
      else { this.left = -this.itemWidth; this.galleryWrapRight(); }
    }, 9);
  }

  stopMovement() {
    clearInterval(this.leftInterval);
    clearInterval(this.rightInterval);
  }
}
customElements.define('globular-image-gallery', ImageGallery);
