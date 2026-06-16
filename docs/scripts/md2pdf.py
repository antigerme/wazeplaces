#!/usr/bin/env python3
"""
Converte markdown em PDF estilizado pros docs do repo.

Uso:
    python3 docs/scripts/md2pdf.py <input.md> <output.pdf>

Deps:
    pip install weasyprint markdown pygments

Paleta cyan combinando com a app (#33CCFF). A4, 12pt-ish, footer com
numeração de página. Tabelas, code blocks com syntax highlight, blockquotes.
"""
import sys
import markdown
from weasyprint import HTML, CSS

CSS_STYLE = """
@page {
  size: A4;
  margin: 18mm 16mm 18mm 16mm;
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #888; }
  @bottom-left { content: "Waze Places — docs"; font-size: 8pt; color: #888; }
}
html { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1e293b; }
body { max-width: 100%; }
h1 { font-size: 22pt; color: #0891b2; border-bottom: 3px solid #33CCFF; padding-bottom: 6pt; margin-top: 0; }
h2 { font-size: 15pt; color: #155e75; margin-top: 22pt; border-left: 4px solid #33CCFF; padding-left: 10pt; }
h3 { font-size: 12pt; color: #334155; margin-top: 16pt; }
h4 { font-size: 10.5pt; color: #475569; margin-top: 12pt; }
p { margin: 6pt 0; }
strong { color: #0e7490; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 9.5pt; page-break-inside: avoid; }
th { background: #ecfeff; color: #155e75; text-align: left; padding: 6pt 8pt; border: 1px solid #67e8f9; }
td { padding: 5pt 8pt; border: 1px solid #e5e7eb; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
ul, ol { margin: 5pt 0 5pt 18pt; padding: 0; }
li { margin: 2pt 0; }
code { font-family: 'Menlo', 'Consolas', 'Courier New', monospace; font-size: 9pt; background: #f1f5f9; padding: 1pt 4pt; border-radius: 3px; color: #be185d; }
pre { background: #0f172a; color: #e2e8f0; padding: 10pt 12pt; border-radius: 6px; font-size: 8.5pt; line-height: 1.35; overflow-x: auto; page-break-inside: avoid; margin: 8pt 0; }
pre code { background: transparent; color: inherit; padding: 0; }
hr { border: 0; border-top: 1px solid #cbd5e1; margin: 18pt 0; }
em { color: #475569; }
blockquote { border-left: 3px solid #33CCFF; padding-left: 10pt; color: #475569; margin: 8pt 0; }
"""


def main():
    if len(sys.argv) != 3:
        print("uso: md2pdf.py <input.md> <output.pdf>", file=sys.stderr)
        sys.exit(1)
    md_path, pdf_path = sys.argv[1], sys.argv[2]
    with open(md_path, encoding='utf-8') as f:
        md = f.read()
    html_body = markdown.markdown(
        md,
        extensions=['tables', 'fenced_code', 'codehilite', 'toc'],
        extension_configs={'codehilite': {'guess_lang': False, 'noclasses': True}}
    )
    html_doc = f"<html><head><meta charset='utf-8'></head><body>{html_body}</body></html>"
    HTML(string=html_doc).write_pdf(pdf_path, stylesheets=[CSS(string=CSS_STYLE)])
    print(f"PDF gerado em {pdf_path}")


if __name__ == '__main__':
    main()
