'use strict';

// Behavioral tests for the standalone form. The DOM below models browser events
// and uses a real raster canvas, so geometry/cropping assertions inspect PNG data.
// Browser layout and the final two-page print result still require visual QA.
// Run with: node --test tests/conformidade-signatures.test.cjs
// Test dependency: @napi-rs/canvas (declared in tests/package.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, loadImage, Image } = require('@napi-rs/canvas');

const sourcePath = path.resolve(__dirname, '../conformidade-signatures.js');
const camel = value => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class DomEvent {
  constructor(type, init = {}) {
    Object.assign(this, { type, bubbles: true, cancelable: true, defaultPrevented: false }, init);
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

class DomNode {
  constructor(tag = 'div', attributes = {}, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.attributes = {}; this.dataset = {}; this.children = []; this.listeners = new Map();
    this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    this.hidden = false; this.disabled = false; this.checked = false; this.value = '';
    this.defaultValue = ''; this.defaultChecked = false; this.textContent = ''; this.innerHTML = '';
    this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => { const enabled = force ?? !this.classes.has(name); enabled ? this.classes.add(name) : this.classes.delete(name); return enabled; } };
    this.classes = new Set();
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
    if (['id', 'name', 'type', 'value', 'src'].includes(name)) this[name] = String(value);
    if (name === 'class') this.classes = new Set(String(value).split(/\s+/));
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  get src() { return this.attributes.src || ''; }
  set src(value) { this.attributes.src = String(value); this.srcAssignments = (this.srcAssignments || 0) + 1; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'hidden') this.hidden = false; }
  toggleAttribute(name, force) { const on = force ?? !this.hasAttribute(name); on ? this.setAttribute(name, '') : this.removeAttribute(name); return on; }
  appendChild(node) { node.parentElement = node.parentNode = this; node.ownerDocument = this.ownerDocument; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  addEventListener(type, callback, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ callback, once: Boolean(options.once) });
  }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback)); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const item of [...(this.listeners.get(event.type) || [])]) {
      item.callback.call(this, event); if (item.once) this.removeEventListener(event.type, item.callback);
    }
    if (event.bubbles && !event.stopped && this.parentElement) this.parentElement.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    selector = selector.trim();
    const attrs = [...selector.matchAll(/\[([^\]=\s]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)];
    const base = selector.replace(/\[[^\]]+\]/g, '').replace(/:checked/g, '');
    if (selector.includes(':checked') && !this.checked) return false;
    const tag = base.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const id = base.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    for (const [, cls] of base.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(cls)) return false;
    for (const [, name, expected] of attrs) {
      const actual = name in this && ['name', 'type', 'value', 'id'].includes(name) ? this[name] : this.getAttribute(name);
      if (expected === undefined ? actual === null || actual === undefined : actual !== expected) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const out = [];
    const visit = parent => { for (const child of parent.children) { if (child.matches(selector)) out.push(child); visit(child); } };
    visit(this); return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node && !node.matches(selector)) node = node.parentElement; return node; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) this.dispatchEvent(new DomEvent('click')); }
  getBoundingClientRect() { return this.rect || { left: 50, top: 100, width: 500, height: 150, right: 550, bottom: 250 }; }
  setPointerCapture(id) { this.capturedPointer = id; }
  hasPointerCapture(id) { return this.capturedPointer === id; }
  releasePointerCapture(id) { if (this.capturedPointer === id) this.capturedPointer = null; }
  reset() {
    if (!this.dispatchEvent(new DomEvent('reset'))) return;
    for (const input of this.querySelectorAll('input')) { input.value = input.defaultValue; input.checked = input.defaultChecked; }
  }
}

class CanvasNode extends DomNode {
  constructor(document, noContext = false) { super('canvas', {}, document); this.surface = createCanvas(1000, 300); this.noContext = noContext; }
  get width() { return this.surface.width; } set width(value) { this.surface.width = Number(value); }
  get height() { return this.surface.height; } set height(value) { this.surface.height = Number(value); }
  getContext(type) {
    if (this.noContext || type !== '2d') return null;
    if (!this.context) {
      const context = this.surface.getContext('2d');
      this.context = new Proxy(context, {
        get: (target, key) => key === 'canvas' ? this : key === 'drawImage'
          ? (image, ...args) => target.drawImage(image.surface || image, ...args)
          : typeof target[key] === 'function' ? target[key].bind(target) : target[key],
        set: (target, key, value) => { target[key] = value; return true; }
      });
    }
    return this.context;
  }
  toDataURL(...args) { return this.surface.toDataURL(...args); }
}

function fixture({ noContext = false } = {}) {
  const document = new DomNode('document'); document.ownerDocument = document;
  document.readyState = 'complete'; document.activeElement = null;
  document.createElement = tag => tag === 'canvas' ? new CanvasNode(document, noContext) : new DomNode(tag, {}, document);
  document.getElementById = id => document.querySelector('#' + id);
  const add = (parent, tag, attrs = {}) => { const node = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); return parent.appendChild(node); };
  const body = add(document, 'body'); document.body = body; document.documentElement = body;
  const form = add(body, 'form', { id: 'compliance-form' });
  const fields = {};
  for (const name of ['student', 'guardian', 'class', 'teacher', 'group', 'advisor', 'date']) fields[name] = add(form, 'input', { name, type: 'text', ...(name === 'guardian' ? { id: 'guardian-name' } : {}) });
  // The school-owned readonly field must survive native reset with its default.
  fields.teacher.value = fields.teacher.defaultValue = 'Prof. Esp. Bruno Michel Pera';
  fields.teacher.readOnly = true; fields.teacher.setAttribute('readonly', '');
  const print = add(body, 'button', { id: 'print-document', type: 'button' });
  const clear = add(body, 'button', { id: 'clear-document', type: 'button' });
  const roles = {};
  for (const role of ['student', 'guardian']) {
    const fieldset = add(form, 'fieldset', { 'data-signature': role });
    const paper = add(fieldset, 'input', { type: 'radio', name: `signature_${role}`, value: 'paper' }); paper.checked = paper.defaultChecked = true; paper.defaultValue = 'paper';
    const draw = add(fieldset, 'input', { type: 'radio', name: `signature_${role}`, value: 'draw' }); draw.defaultValue = 'draw';
    const pad = add(fieldset, 'div', { 'data-signature-pad': role, hidden: '' });
    const canvas = add(pad, 'canvas', { 'data-signature-canvas': role });
    const clear = add(pad, 'button', { 'data-signature-clear': role, type: 'button' });
    const status = add(fieldset, 'p', { 'data-signature-status': role, 'aria-live': 'polite' });
    const line = add(form, 'div', { 'data-signature-slot': role, class: 'signature-slot' });
    const image = add(line, 'img', { 'data-signature-image': role, hidden: '' });
    const name = add(line, 'span', { 'data-signature-name': role });
    roles[role] = { fieldset, paper, draw, pad, canvas, clear, status, line, image, name };
  }
  const window = new DomNode('window'); const sideEffects = [];
  const forbidden = name => (...args) => { sideEffects.push({ name, args }); throw new Error(`Unexpected ${name}`); };
  const storage = new Proxy({}, { get: (_, key) => forbidden(`storage.${String(key)}`) });
  let prints = 0;
  const context = { document, window, console, Image, Event: DomEvent, PointerEvent: DomEvent,
    HTMLCanvasElement: CanvasNode, localStorage: storage, sessionStorage: storage,
    fetch: forbidden('fetch'), XMLHttpRequest: forbidden('XMLHttpRequest'),
    indexedDB: new Proxy({}, { get: (_, key) => forbidden(`indexedDB.${String(key)}`) }),
    navigator: { sendBeacon: forbidden('sendBeacon') },
    setTimeout, clearTimeout, queueMicrotask, requestAnimationFrame: callback => { callback(0); return 1; }, cancelAnimationFrame() {} };
  Object.assign(window, context, { devicePixelRatio: 2,
    print() { window.dispatchEvent(new DomEvent('beforeprint')); prints++; window.dispatchEvent(new DomEvent('afterprint')); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  window.window = window; document.defaultView = window; document.parentElement = document.parentNode = window;
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  document.dispatchEvent(new DomEvent('DOMContentLoaded'));
  return { document, window, form, fields, roles, print, clear, sideEffects, get prints() { return prints; } };
}

function mode(role, value) {
  role.paper.checked = value === 'paper'; role.draw.checked = value === 'draw';
  role[value].dispatchEvent(new DomEvent('change'));
}
function pointer(canvas, type, x, y, extra = {}) {
  const event = new DomEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...extra });
  canvas.dispatchEvent(event); return event;
}
function stroke(role, points = [[100, 130], [200, 170], [250, 140]], extra = {}) {
  pointer(role.canvas, 'pointerdown', ...points[0], extra);
  points.slice(1).forEach(point => pointer(role.canvas, 'pointermove', ...point, extra));
  pointer(role.canvas, 'pointerup', ...points.at(-1), extra);
}
function bounds(canvas) {
  const { width, height } = canvas;
  const data = (canvas.surface || canvas).getContext('2d').getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
  }
  return count ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, count, data } : null;
}
async function decodedPreview(role) {
  assert.match(role.image.src || '', /^data:image\/png;base64,/);
  const image = await loadImage(role.image.src); const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0); return canvas;
}

test('both people start in paper mode, and submitting never navigates or sends data', () => {
  const f = fixture();
  for (const role of Object.values(f.roles)) { assert.equal(role.paper.checked, true); assert.equal(role.pad.hidden, true); assert.equal(role.image.hidden, true); assert.equal(bounds(role.canvas), null); }
  assert.equal(f.form.dispatchEvent(new DomEvent('submit')), false);
  assert.deepEqual(f.sideEffects, []);
});

test('desktop drawing creates a tightly cropped transparent PNG only on that person’s line', async () => {
  const f = fixture(); const role = f.roles.student; mode(role, 'draw');
  assert.equal(role.pad.hidden, false); stroke(role);
  assert.equal(role.image.hidden, false); assert.equal(f.roles.guardian.image.hidden, true);
  const original = bounds(role.canvas); const preview = await decodedPreview(role); const ink = bounds(preview);
  assert.ok(original && ink); assert.ok(preview.width < role.canvas.width / 2); assert.ok(preview.height < role.canvas.height / 2);
  assert.equal(ink.width, original.width); assert.equal(ink.height, original.height);
  assert.ok(ink.count < preview.width * preview.height); assert.equal(ink.data[3], 0);
  assert.equal(role.canvas.capturedPointer, null); assert.deepEqual(f.sideEffects, []);
});

test('touch coordinates map correctly when the canvas is scaled down on mobile', async () => {
  const f = fixture(); const role = f.roles.guardian; mode(role, 'draw');
  role.canvas.rect = { left: 12, top: 30, width: 250, height: 75, right: 262, bottom: 105 };
  stroke(role, [[62, 55], [112, 65], [162, 60]], { pointerType: 'touch', pointerId: 7 });
  const ink = bounds(role.canvas); assert.ok(ink);
  assert.ok(Math.abs(ink.left - 200) <= 4); assert.ok(Math.abs(ink.right - 600) <= 4);
  assert.ok(Math.abs(ink.top - 100) <= 4); assert.ok(Math.abs(ink.bottom - 140) <= 4);
  const preview = await decodedPreview(role); assert.ok(preview.width < 430 && preview.height < 70);
  assert.equal(f.roles.student.image.hidden, true);
});

test('secondary buttons and additional pointers cannot start or corrupt the active stroke', () => {
  const f = fixture(); const role = f.roles.student; mode(role, 'draw');
  pointer(role.canvas, 'pointerdown', 100, 130, { button: 2, buttons: 2 });
  pointer(role.canvas, 'pointermove', 200, 150, { button: 2, buttons: 2 });
  pointer(role.canvas, 'pointerup', 200, 150, { button: 2 });
  pointer(role.canvas, 'pointerdown', 100, 130, { isPrimary: false, pointerId: 2, pointerType: 'touch' });
  pointer(role.canvas, 'pointerup', 200, 150, { isPrimary: false, pointerId: 2, pointerType: 'touch' });
  assert.equal(bounds(role.canvas), null);
  pointer(role.canvas, 'pointerdown', 100, 130, { pointerId: 3 });
  pointer(role.canvas, 'pointermove', 500, 240, { pointerId: 4, isPrimary: false });
  pointer(role.canvas, 'pointerup', 500, 240, { pointerId: 4, isPrimary: false });
  pointer(role.canvas, 'pointermove', 150, 150, { pointerId: 3 });
  pointer(role.canvas, 'pointerup', 150, 150, { pointerId: 3 });
  const ink = bounds(role.canvas); assert.ok(ink); assert.ok(ink.right < 205 && ink.bottom < 105);
});

test('paper mode hides but preserves a drawing, and a per-person clear affects only that person', () => {
  const f = fixture(); const student = f.roles.student; const guardian = f.roles.guardian;
  mode(student, 'draw'); mode(guardian, 'draw'); stroke(student); stroke(guardian, [[110, 140], [180, 160]]);
  const studentPng = student.image.src; const guardianPng = guardian.image.src;
  mode(student, 'paper'); assert.equal(student.pad.hidden, true); assert.equal(student.image.hidden, true);
  mode(student, 'draw'); assert.equal(student.image.hidden, false); assert.equal(student.image.src, studentPng);
  student.clear.click(); assert.equal(student.image.hidden, true); assert.ok(!student.image.src); assert.equal(bounds(student.canvas), null);
  assert.equal(guardian.image.src, guardianPng); assert.equal(guardian.image.hidden, false); assert.ok(bounds(guardian.canvas));
});

test('pointer cancellation and lost capture finalize ink without using bogus event coordinates', () => {
  for (const eventType of ['pointercancel', 'lostpointercapture']) {
    const f = fixture(); const role = f.roles.student; mode(role, 'draw');
    pointer(role.canvas, 'pointerdown', 100, 130); pointer(role.canvas, 'pointermove', 160, 160);
    const before = bounds(role.canvas);
    pointer(role.canvas, eventType, 100000, -100000);
    const after = bounds(role.canvas); assert.equal(after.width, before.width); assert.equal(after.height, before.height);
    assert.equal(role.image.hidden, false);
    stroke(role, [[180, 130], [200, 140]], { pointerId: 9 }); assert.ok(bounds(role.canvas).right > before.right);
  }
});

test('the total clear preserves school defaults and resets editable fields, modes and both drawings', async () => {
  const f = fixture();
  for (const [name, field] of Object.entries(f.fields)) {
    if (!field.readOnly) { field.value = 'Teste ' + name; field.dispatchEvent(new DomEvent('input')); }
  }
  for (const role of Object.values(f.roles)) { mode(role, 'draw'); stroke(role); }
  f.clear.click(); await new Promise(resolve => setTimeout(resolve, 0));
  for (const field of Object.values(f.fields)) assert.equal(field.value, field.defaultValue);
  for (const [key, role] of Object.entries(f.roles)) {
    assert.equal(role.paper.checked, true); assert.equal(role.draw.checked, false); assert.equal(role.pad.hidden, true);
    assert.equal(role.image.hidden, true); assert.ok(!role.image.src);
    assert.equal(role.name.textContent, key === 'student' ? 'Assinatura' : 'Nome e assinatura'); assert.equal(bounds(role.canvas), null);
    mode(role, 'draw'); assert.equal(role.image.hidden, true); assert.equal(bounds(role.canvas), null);
  }
  assert.equal(f.document.activeElement, f.fields.student); assert.deepEqual(f.sideEffects, []);
});

test('names map to the matching signature and printing preserves selected drawings without sending data', () => {
  const f = fixture();
  f.fields.student.value = 'Aluno de teste'; f.fields.student.dispatchEvent(new DomEvent('input'));
  f.fields.guardian.value = 'Responsável de teste'; f.fields.guardian.dispatchEvent(new DomEvent('input'));
  assert.equal(f.roles.student.name.textContent, 'Aluno de teste'); assert.equal(f.roles.guardian.name.textContent, 'Responsável de teste');
  mode(f.roles.student, 'draw'); stroke(f.roles.student); const src = f.roles.student.image.src;
  const assignments = f.roles.student.image.srcAssignments;
  f.print.click(); assert.equal(f.prints, 1); assert.equal(f.roles.student.image.src, src); assert.equal(f.roles.student.image.hidden, false);
  assert.equal(f.roles.student.image.srcAssignments, assignments, 'printing should keep an already prepared image without restarting decoding');
  assert.equal(f.roles.guardian.image.hidden, true); assert.deepEqual(f.sideEffects, []);
});

test('a missing canvas context leaves a usable paper-only form', () => {
  const f = fixture({ noContext: true });
  for (const role of Object.values(f.roles)) { assert.equal(role.draw.disabled, true); assert.equal(role.paper.checked, true); assert.equal(role.pad.hidden, true); assert.equal(role.image.hidden, true); }
  f.print.click(); assert.equal(f.prints, 1); assert.deepEqual(f.sideEffects, []);
});
