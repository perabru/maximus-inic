#!/usr/bin/env python3
"""Build the two-page school term from conformidade.html, without signatures.

Run from any directory: python3 scripts/build-term-template.py
Requires ReportLab and the DejaVu Sans regular/bold fonts. An alternative font
directory can be provided with --font-dir. Use --output for a preview copy.
The HTML is the source of all clauses, names, signature labels and references.
This only generates the blank student template; it never reads account data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
PAGE_W, PAGE_H = A4
MARGIN = 43
WIDTH = PAGE_W - 2 * MARGIN
PURPLE = colors.HexColor('#3d4094')
ORANGE = colors.HexColor('#f38635')
INK = colors.HexColor('#27283f')
MUTED = colors.HexColor('#66687a')
LINE = colors.HexColor('#deddec')
SOFT = colors.HexColor('#f2f1fa')


@dataclass
class Element:
    tag: str
    attrs: dict[str, str | None] = field(default_factory=dict)
    children: list[Element | str] = field(default_factory=list)

    def elements(self, tag=None, cls=None):
        for child in self.children:
            if isinstance(child, Element):
                if (tag is None or child.tag == tag) and (
                    cls is None or cls in (child.attrs.get('class') or '').split()
                ):
                    yield child
                yield from child.elements(tag, cls)

    def first(self, tag=None, cls=None):
        return next(self.elements(tag, cls))

    def text(self):
        return ' '.join(''.join(
            child.text() if isinstance(child, Element) else child
            for child in self.children
        ).split())

    def markup(self):
        result = []
        for child in self.children:
            if isinstance(child, str):
                result.append(escape(child))
            elif child.tag == 'br':
                result.append('<br/>')
            elif child.tag in ('strong', 'b'):
                result.append('<b>' + child.markup() + '</b>')
            elif child.tag in ('em', 'i'):
                result.append('<i>' + child.markup() + '</i>')
            elif child.tag == 'a':
                href = escape(child.attrs.get('href') or '', {'"': '&quot;'})
                result.append(f'<link href="{href}" color="#3d4094">{child.markup()}</link>')
            elif child.tag != 'input':
                result.append(child.markup())
        return ''.join(result)


class TemplateParser(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element('root')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        element = Element(tag, dict(attrs))
        self.stack[-1].children.append(element)
        if tag not in self.VOID:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def register_fonts(font_dir):
    candidates = [Path(font_dir)] if font_dir else [
        Path('/usr/share/fonts/truetype/dejavu'),
        Path('/usr/local/share/fonts/dejavu'),
    ]
    for candidate in candidates:
        if all((candidate / name).is_file() for name in ('DejaVuSans.ttf', 'DejaVuSans-Bold.ttf')):
            pdfmetrics.registerFont(TTFont('TermRegular', str(candidate / 'DejaVuSans.ttf')))
            pdfmetrics.registerFont(TTFont('TermBold', str(candidate / 'DejaVuSans-Bold.ttf')))
            pdfmetrics.registerFontFamily('TermRegular', normal='TermRegular', bold='TermBold')
            return
    raise SystemExit('DejaVu Sans fonts not found. Install fonts-dejavu-core or pass --font-dir.')


class TermPdf:
    def __init__(self, output):
        self.canvas = Canvas(str(output), pagesize=A4, pageCompression=1, invariant=1)
        self.canvas.setTitle('Termo de ciência e compromisso - INIC 2027 - Escola Máximu’s')
        self.canvas.setAuthor('Escola Máximu’s')
        self.canvas.setSubject('Modelo escolar para preenchimento e assinatura - INIC 2027')
        self.canvas.setCreator('scripts/build-term-template.py')

    def paragraph(self, content, y, *, x=MARGIN, width=WIDTH, size=9.7,
                  leading=14.2, color=INK, bold=False, align=TA_LEFT):
        style = ParagraphStyle('term', fontName='TermBold' if bold else 'TermRegular',
                               fontSize=size, leading=leading, textColor=color,
                               alignment=align, allowWidows=0, allowOrphans=0)
        paragraph = Paragraph(content, style)
        _, height = paragraph.wrap(width, PAGE_H)
        if y - height < 55:
            raise ValueError(f'Template overflows page {self.canvas.getPageNumber()}: {content[:80]}')
        paragraph.drawOn(self.canvas, x, y - height)
        return y - height

    def header(self, page):
        canvas = self.canvas
        logo_width = 170
        logo_height = logo_width * 270 / 923
        canvas.drawImage(str(ROOT / 'assets/logo-maximus.png'), MARGIN,
                         PAGE_H - 33 - logo_height, width=logo_width,
                         height=logo_height, mask='auto')
        canvas.setFillColor(PURPLE)
        canvas.setFont('TermBold', 9.8)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 48, 'INIC 2027')
        canvas.setFont('TermRegular', 6.7)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 63, 'CIÊNCIA E COMPROMISSO')
        canvas.setStrokeColor(ORANGE)
        canvas.setLineWidth(1.7)
        canvas.line(MARGIN, PAGE_H - 94, PAGE_W - MARGIN, PAGE_H - 94)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(.5)
        canvas.line(MARGIN, 43, PAGE_W - MARGIN, 43)
        canvas.setFillColor(MUTED)
        canvas.setFont('TermRegular', 6.5)
        canvas.drawString(MARGIN, 29, 'Escola Máximu’s · Planejamento escolar para 2027')
        canvas.drawRightString(PAGE_W - MARGIN, 29, f'{page} / 2')

    def field(self, label, value, x, y, width):
        self.paragraph(escape(label), y, x=x, width=width, size=7.3, leading=10, color=MUTED)
        if value:
            self.paragraph(escape(value), y - 12, x=x + 3, width=width - 6,
                           size=9.7, leading=12, bold=True)
        self.canvas.setStrokeColor(colors.HexColor('#a6a6bd'))
        self.canvas.setLineWidth(.55)
        self.canvas.line(x, y - 27, x + width, y - 27)

    def heading(self, section, y):
        heading = section.first('h3')
        number = heading.first('span').text()
        title = heading.text().removeprefix(number).strip()
        self.paragraph(escape(number), y, width=20, size=8.2, leading=14, color=ORANGE, bold=True)
        return self.paragraph(escape(title), y, x=MARGIN + 22, width=WIDTH - 22,
                              size=10.3, leading=14, color=PURPLE, bold=True) - 6

    def signature(self, element, x, y, width):
        self.canvas.setStrokeColor(colors.HexColor('#9292a7'))
        self.canvas.setLineWidth(.6)
        self.canvas.line(x, y, x + width, y)
        y = self.paragraph(element.first('strong').markup(), y - 6, x=x, width=width,
                           size=9.2, leading=13, bold=True, align=TA_CENTER)
        people = list(element.elements(cls='signature-person'))
        if people:
            y = self.paragraph(people[0].markup(), y - 2, x=x, width=width,
                               size=8.7, leading=12.5, align=TA_CENTER)
        caption = [child for child in element.children if isinstance(child, Element)][-1]
        return self.paragraph(caption.markup(), y - 2, x=x, width=width,
                              size=7.5, leading=10.5, color=MUTED, align=TA_CENTER)


def build(output, font_dir=None):
    register_fonts(font_dir)
    parser = TemplateParser()
    parser.feed((ROOT / 'conformidade.html').read_text(encoding='utf-8'))
    document = parser.root.first(cls='sheet')
    clauses = list(document.elements('section', 'clause'))
    if len(clauses) != 4:
        raise ValueError('The template must contain its four original clauses.')
    signatures = document.first(cls='signatures')
    signature_fields = [child for child in signatures.children if isinstance(child, Element)]
    if len(signature_fields) != 4:
        raise ValueError('The template must contain student, guardian and two school signature fields.')
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = TermPdf(output)
    pdf.header(1)

    title = document.first(cls='document-title')
    y = pdf.paragraph(title.first(cls='kicker').markup(), PAGE_H - 109,
                      size=7.4, leading=10, color=PURPLE, bold=True) - 6
    y = pdf.paragraph(title.first('h2').markup(), y, size=20.5, leading=23.5,
                      color=PURPLE, bold=True) - 7
    introduction = [child for child in title.children if isinstance(child, Element)][-1]
    y = pdf.paragraph(introduction.markup(), y, size=8.6, leading=12, color=MUTED) - 14

    fields = {}
    for label in document.first(cls='identification').elements('label'):
        input_element = label.first('input')
        fields[input_element.attrs['name']] = (label.text(), input_element.attrs.get('value') or '')
    half = (WIDTH - 25) / 2
    pdf.field(*fields['student'], MARGIN, y, WIDTH)
    y -= 34
    pdf.field(*fields['class'], MARGIN, y, half)
    pdf.field(*fields['teacher'], MARGIN + half + 25, y, half)
    y -= 34
    pdf.field(*fields['group'], MARGIN, y, WIDTH)
    y -= 34
    pdf.field(*fields['advisor'], MARGIN, y, WIDTH)
    y -= 43

    for section in clauses[:3]:
        y = pdf.heading(section, y)
        for child in section.children:
            if not isinstance(child, Element):
                continue
            if child.tag == 'p':
                is_location = 'location' in (child.attrs.get('class') or '').split()
                y = pdf.paragraph(child.markup(), y,
                                  size=8.7 if is_location else 9.7,
                                  leading=12.5 if is_location else 14.2,
                                  color=MUTED if is_location else INK) - 5
            elif child.tag == 'ul':
                for item in child.elements('li'):
                    pdf.paragraph('•', y, width=10, size=9.7, leading=14.2, color=PURPLE)
                    y = pdf.paragraph(item.markup(), y, x=MARGIN + 12, width=WIDTH - 12) - 4
        y -= 9
    pdf.canvas.showPage()

    pdf.header(2)
    y = pdf.paragraph('Termo de ciência e compromisso', PAGE_H - 102,
                      size=18.2, leading=24, color=PURPLE, bold=True) - 4
    y = pdf.paragraph('Continuação · Leia esta página antes de assinar.', y,
                      size=9.1, leading=13, color=MUTED) - 29
    financial = clauses[3]
    y = pdf.heading(financial, y)
    paragraphs = [child for child in financial.children if isinstance(child, Element) and child.tag == 'p']
    y = pdf.paragraph(paragraphs[0].markup(), y, size=10, leading=15.1) - 14

    estimate_rows = [child for child in financial.first(cls='estimates').children if isinstance(child, Element)]
    row_height = 43
    pdf.canvas.setFillColor(SOFT)
    pdf.canvas.setStrokeColor(LINE)
    pdf.canvas.setLineWidth(.6)
    pdf.canvas.rect(MARGIN, y - len(estimate_rows) * row_height, WIDTH,
                    len(estimate_rows) * row_height, fill=1, stroke=1)
    middle = MARGIN + WIDTH * .55
    pdf.canvas.line(middle, y, middle, y - len(estimate_rows) * row_height)
    for index, row in enumerate(estimate_rows):
        if index:
            pdf.canvas.line(MARGIN, y, PAGE_W - MARGIN, y)
        pdf.paragraph(row.first('strong').markup(), y - 9, x=MARGIN + 12,
                       width=WIDTH * .55 - 24, size=9.1, leading=13.2, color=MUTED)
        estimate = row.first('span').markup().replace(' · ', '<br/>')
        pdf.paragraph(estimate, y - 9, x=middle + 12, width=WIDTH * .45 - 24,
                       size=8.7, leading=13.2, color=PURPLE)
        y -= row_height
    y = pdf.paragraph(paragraphs[1].markup(), y - 13, size=8.6, leading=12.4,
                      color=colors.HexColor('#6b553f')) - 21

    declaration = document.first(cls='declaration')
    y = pdf.paragraph(declaration.first('p').markup(), y, size=9.7, leading=14.6) - 13
    y = pdf.paragraph('São José dos Campos, ______ de ________________________ de 2027.',
                      y, size=9.5, leading=14) - 39

    column_gap = 34
    column_width = (WIDTH - column_gap) / 2
    pdf.signature(signature_fields[0], MARGIN, y, column_width)
    pdf.signature(signature_fields[1], MARGIN + column_width + column_gap, y, column_width)
    y -= 67
    bottom = min(
        pdf.signature(signature_fields[2], MARGIN, y, column_width),
        pdf.signature(signature_fields[3], MARGIN + column_width + column_gap, y, column_width),
    )
    y = pdf.paragraph(document.first(cls='signature-disclaimer').markup(), bottom - 12,
                      size=7.2, leading=10.5, color=MUTED, align=TA_CENTER) - 12

    pdf.canvas.setStrokeColor(LINE)
    pdf.canvas.setLineWidth(.6)
    pdf.canvas.line(MARGIN, y, PAGE_W - MARGIN, y)
    sources = document.first(cls='document-sources')
    y = pdf.paragraph(sources.first('strong').markup(), y - 10, size=7.1,
                      leading=10, color=PURPLE, bold=True) - 5
    for source in [child for child in sources.children if isinstance(child, Element) and child.tag == 'p']:
        y = pdf.paragraph(source.markup(), y, size=7.3, leading=10.8)
    pdf.paragraph(sources.first('small').markup(), y - 9, size=6.6, leading=9.6, color=MUTED)

    if pdf.canvas.getPageNumber() != 2:
        raise ValueError('The generated term must have exactly two pages.')
    pdf.canvas.save()
    print(f'Built two-page school term: {output}')


if __name__ == '__main__':
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument('--output', type=Path,
                           default=ROOT / 'documentos/Termo_Compromisso_INIC_2027_Maximus.pdf')
    arguments.add_argument('--font-dir')
    options = arguments.parse_args()
    build(options.output.resolve(), options.font_dir)
