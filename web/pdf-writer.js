/*
 * Minimal PDF 1.4 writer used for image -> PDF conversion.
 */

(function (root) {
  'use strict';

  function latin1(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function concat(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function num(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(Math.abs(value) * 10000) / 10000;
    let s = String(rounded);
    if (s.indexOf('.') !== -1) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return (value < 0 ? '-' : '') + s;
  }

  function colorSpaceOf(components) {
    if (components === 1) return '/DeviceGray';
    if (components === 4) return '/DeviceCMYK';
    return '/DeviceRGB';
  }

  function writePdf(images, options) {
    if (!Array.isArray(images) || images.length < 1) {
      throw new Error('writePdf: at least one image is required');
    }
    const opts = options || {};
    const fit = opts.fit !== false;
    const pageW = opts.w || 0;
    const pageH = opts.h || 0;
    const n = images.length;

    const headerBytes = latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const chunks = [headerBytes];

    const catalogId = 1;
    const pagesId = 2;
    const offsets = new Map();
    let offset = headerBytes.length;

    const emit = (objId, objChunks) => {
      const bytes = concat(objChunks);
      offsets.set(objId, offset);
      offset += bytes.length;
      chunks.push(bytes);
    };

    let nextId = 3;
    const pageIds = [];

    for (let i = 0; i < n; i++) {
      const img = images[i];
      if (!img.jpeg || img.jpeg.length === 0) {
        throw new Error(`writePdf: image ${i} has no JPEG data`);
      }
      if (!Number.isFinite(img.width) || !Number.isFinite(img.height) ||
          img.width <= 0 || img.height <= 0) {
        throw new Error(`writePdf: image ${i} has invalid dimensions`);
      }

      const imgW = img.width;
      const imgH = img.height;
      const pw = pageW > 0 ? pageW : imgW;
      const ph = pageH > 0 ? pageH : imgH;
      const scale = fit ? Math.min(pw / imgW, ph / imgH) : 1;
      const ox = (pw - imgW * scale) / 2;
      const oy = (ph - imgH * scale) / 2;

      const xobjId = nextId++;
      const contentId = nextId++;
      const pageId = nextId++;

      emit(xobjId, [
        latin1(
          `${xobjId} 0 obj\n` +
          `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
          `/ColorSpace ${colorSpaceOf(img.components)} /BitsPerComponent 8 ` +
          `/Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
        ),
        img.jpeg,
        latin1('\nendstream\nendobj\n')
      ]);

      const drawnW = imgW * scale;
      const drawnH = imgH * scale;
      const content =
        `q\n${num(drawnW)} 0 0 ${num(drawnH)} ${num(ox)} ${num(oy)} cm\n/Im${i} Do\nQ\n`;
      emit(contentId, [
        latin1(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`),
        latin1(content),
        latin1('endstream\nendobj\n')
      ]);

      emit(pageId, [
        latin1(
          `${pageId} 0 obj\n` +
          `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${num(pw)} ${num(ph)}] ` +
          `/Resources << /XObject << /Im${i} ${xobjId} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>\nendobj\n`
        )
      ]);

      pageIds.push(pageId);
    }

    emit(pagesId, [
      latin1(
        `${pagesId} 0 obj\n` +
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
        `/Count ${n} >>\nendobj\n`
      )
    ]);

    emit(catalogId, [
      latin1(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`)
    ]);

    const xrefStart = offset;
    let xref = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
    for (let i = 1; i < nextId; i++) {
      xref += String(offsets.get(i) || 0).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    return concat([...chunks, latin1(xref)]);
  }

  const bundle = Object.freeze({
    writePdf: writePdf
  });

  root.PDF_WRITER = bundle;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = bundle;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
