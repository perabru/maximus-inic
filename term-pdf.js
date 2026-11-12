/* Fill the public school template locally. Drawn signatures are not certificates. */
import { PDFDocument, StandardFonts, rgb } from './assets/vendor/pdf-lib-1.17.1.esm.min.js';
import { validateSignatureImage } from './signed-term-pdf.js';

const EDITION = 2027;
const REVISION = '20261112-12';
const TEMPLATE_NAME = 'Termo_Compromisso_INIC_2027_Maximus.pdf';
const TEMPLATE_URL = new URL(`./documentos/${TEMPLATE_NAME}?v=${REVISION}`, import.meta.url);
const LAYOUT_URL = new URL(`./documentos/termo-layout.json?v=${REVISION}`, import.meta.url);
const MAX_BYTES = 3 * 1024 * 1024;
const INK = rgb(0.15, 0.16, 0.25);
const FIELD_DEFINITIONS = Object.freeze({
  student: { label: 'nome do aluno', maxLength: 120 },
  class: { label: 'turma / série', maxLength: 40 },
  group: { label: 'nome do grupo / tema da pesquisa', maxLength: 180 },
  advisor: { label: 'nome do orientador', maxLength: 120 },
  guardian: { label: 'nome do responsável', maxLength: 120 },
  date: { label: 'data da assinatura', maxLength: 45 }
});

function fail(message) { throw new Error(message); }
function modelError() { fail('O modelo do termo está desatualizado ou incompleto. Atualize a página e tente baixar novamente.'); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fieldValues(fields) {
  if (!object(fields)) fail('Confira os campos do termo antes de gerar o PDF.');
  return Object.fromEntries(Object.entries(FIELD_DEFINITIONS).map(([key, definition]) => {
    const source = fields[key] ?? '';
    if (typeof source !== 'string') fail(`Confira o campo ${definition.label}.`);
    const value = source.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (value.length > definition.maxLength) fail(`O campo ${definition.label} deve ter até ${definition.maxLength} caracteres.`);
    return [key, value];
  }));
}
function signatureValues(signatures, fields) {
  if (!object(signatures) || Object.keys(signatures).some(key => !['student', 'guardian'].includes(key))) {
    fail('Use os campos de assinatura do aluno e do responsável.');
  }
  const result = {};
  for (const key of ['student', 'guardian']) {
    result[key] = validateSignatureImage(signatures[key] ?? '');
    if (result[key] && !fields.student) fail('Preencha o nome do aluno antes de baixar o termo com assinaturas.');
    if (result[key] && key === 'guardian' && !fields.guardian) fail('Preencha o nome do responsável antes de usar sua assinatura.');
  }
  return result;
}
function rectangle(rectangle, pages, pageIndex) {
  if (!object(rectangle) || !Number.isInteger(rectangle.page) || rectangle.page !== pageIndex) modelError();
  const page = pages[rectangle.page];
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(rectangle[key])) modelError();
  if (rectangle.x < 0 || rectangle.y < 0 || rectangle.width < 1 || rectangle.height < 1 ||
      rectangle.x + rectangle.width > page.width + 0.01 || rectangle.y + rectangle.height > page.height + 0.01) modelError();
}
function validateLayout(layout) {
  if (!object(layout) || layout.version !== 1 || layout.template !== TEMPLATE_NAME || layout.pageCount !== 2 ||
      !/^[a-f0-9]{64}$/.test(layout.templateSha256 || '') || !Array.isArray(layout.pages) || layout.pages.length !== 2 ||
      !object(layout.fields) || !object(layout.signatures)) modelError();
  for (const page of layout.pages) {
    if (!object(page) || !Number.isFinite(page.width) || !Number.isFinite(page.height) ||
        Math.abs(page.width - 595.276) > 0.1 || Math.abs(page.height - 841.89) > 0.1) modelError();
  }
  for (const [key, definition] of Object.entries(FIELD_DEFINITIONS)) {
    const box = layout.fields[key];
    rectangle(box, layout.pages, ['guardian', 'date'].includes(key) ? 1 : 0);
    if (box.maxLength !== definition.maxLength || !Number.isFinite(box.fontSize) || !Number.isFinite(box.minFontSize) ||
        box.fontSize < 7 || box.fontSize > 12 || box.minFontSize < 6 || box.minFontSize > box.fontSize ||
        ![1, 2].includes(box.maxLines) || !['left', 'center'].includes(box.align)) modelError();
  }
  for (const key of ['student', 'guardian']) rectangle(layout.signatures[key], layout.pages, 1);
  const a = layout.signatures.student, b = layout.signatures.guardian;
  if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) modelError();
  return layout;
}
async function templateBytes(fetchImpl) {
  if (typeof fetchImpl !== 'function') fail('O navegador não conseguiu carregar o modelo do termo.');
  let pdfResponse, layoutResponse;
  try {
    [pdfResponse, layoutResponse] = await Promise.all([
      fetchImpl(TEMPLATE_URL, { cache: 'no-cache', credentials: 'omit' }),
      fetchImpl(LAYOUT_URL, { cache: 'no-cache', credentials: 'omit' })
    ]);
  } catch { fail('Não foi possível carregar o modelo. Confira sua conexão e tente novamente.'); }
  if (!pdfResponse?.ok || !layoutResponse?.ok) fail('Não foi possível carregar o modelo do termo. Atualize a página e tente novamente.');
  let bytes, layout;
  try {
    [bytes, layout] = await Promise.all([pdfResponse.arrayBuffer().then(value => new Uint8Array(value)), layoutResponse.json()]);
  } catch { modelError(); }
  if (bytes.length < 5 || bytes.length > MAX_BYTES || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') modelError();
  validateLayout(layout);
  if (!globalThis.crypto?.subtle) fail('Use uma conexão segura para conferir e gerar o PDF do termo.');
  const hash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== layout.templateSha256) modelError();
  return { bytes, layout };
}
function wrappedLines(text, font, size, width) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > width) return null;
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}
function drawField(pdf, font, box, value, label) {
  if (!value) return;
  try { font.encodeText(value); }
  catch { fail(`O campo ${label} contém um caractere que não pode ser exibido no PDF. Confira a grafia e os símbolos usados.`); }
  let chosen;
  for (let size = box.fontSize; size >= box.minFontSize - 0.01; size = Math.round((size - 0.25) * 100) / 100) {
    const lines = wrappedLines(value, font, size, box.width);
    const lineHeight = size * 1.16;
    if (lines?.length && lines.length <= box.maxLines && lines.length * lineHeight <= box.height) {
      chosen = { size, lines, lineHeight }; break;
    }
  }
  if (!chosen) fail(`O campo ${label} é longo demais para o espaço disponível. Abrevie o texto e tente novamente.`);
  const { size, lines, lineHeight } = chosen;
  const top = box.y + (box.height + lines.length * lineHeight) / 2;
  lines.forEach((line, index) => {
    const x = box.align === 'center' ? box.x + (box.width - font.widthOfTextAtSize(line, size)) / 2 : box.x;
    pdf.getPage(box.page).drawText(line, { x, y: top - size - index * lineHeight, size, font, color: INK });
  });
}
function outputName(student) {
  const name = student.replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '').replace(/\s+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 90);
  return `Termo_INIC_${EDITION}${name ? `_${name}` : ''}.pdf`;
}

/** No upload, account changes or signature attestation: this returns a local PDF. */
export async function createFilledTermPdf({ fields = {}, signatures = {}, fetchImpl = globalThis.fetch } = {}) {
  const values = fieldValues(fields);
  const images = signatureValues(signatures, values);
  const { bytes, layout } = await templateBytes(fetchImpl);
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { modelError(); }
  if (pdf.getPageCount() !== layout.pageCount) modelError();
  for (let index = 0; index < layout.pageCount; index++) {
    const page = pdf.getPage(index), expected = layout.pages[index];
    if (Math.abs(page.getWidth() - expected.width) > 0.01 || Math.abs(page.getHeight() - expected.height) > 0.01 || page.getRotation().angle !== 0) modelError();
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [key, definition] of Object.entries(FIELD_DEFINITIONS)) drawField(pdf, font, layout.fields[key], values[key], definition.label);
  for (const key of ['student', 'guardian']) {
    if (!images[key]) continue;
    let image;
    try { image = await pdf.embedPng(images[key]); }
    catch { fail('A imagem da assinatura não pôde ser aberta. Limpe o campo e desenhe novamente.'); }
    const box = layout.signatures[key];
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    pdf.getPage(box.page).drawImage(image, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
  }
  pdf.setTitle(`Termo de ciência e compromisso - INIC ${EDITION}`);
  pdf.setAuthor('Escola Máximu’s');
  pdf.setCreator('Máximu’s INIC - preenchimento local');
  pdf.setSubject('Termo preenchido com assinaturas manuscritas desenhadas, quando informadas.');
  pdf.setModificationDate(new Date());
  const output = await pdf.save({ useObjectStreams: true });
  if (output.length > MAX_BYTES) fail('O PDF ficou maior que 3 MB. Limpe e refaça as assinaturas para gerar um arquivo menor.');
  return { blob: new Blob([output], { type: 'application/pdf' }), filename: outputName(values.student) };
}
