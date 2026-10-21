// Test file generators for Office formats that no development
// dependency writes: minimal XLSX and PPTX built by hand with fflate.
// The files are synthetic and used only in tests.
import { zipSync, strToU8 } from 'fflate';

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function zip(files) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** XLSX with sheets `{ name, rows: string|number [][] }`. */
export function makeXlsx(sheets) {
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OD_REL}"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="${REL_NS}">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${OD_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  };
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map((row, r) => `<row r="${r + 1}">${row
        .map((v, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
        })
        .join('')}</row>`)
      .join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zip(files);
}

/** PPTX with slides `{ title, bullets[] }`. */
export function makePptx(slides) {
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides
      .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
      .join('')}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `${XML}<p:presentation xmlns:p="${P}" xmlns:r="${OD_REL}"><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `${XML}<Relationships xmlns="${REL_NS}">${slides
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${OD_REL}/slide" Target="slides/slide${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  };
  slides.forEach((s, i) => {
    const para = (t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`;
    files[`ppt/slides/slide${i + 1}.xml`] = `${XML}<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${para(s.title)}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${s.bullets.map(para).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zip(files);
}
