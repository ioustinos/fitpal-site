#!/usr/bin/env python3
"""WEC-910: add a «Παραστατικό / Document» line to the order confirmation for
non-invoice orders (Απόδειξη / Δελτίο Αποστολής), driven by the backend's
`event.document_type` label. Invoice orders keep their existing Τιμολόγιο row.
Idempotent — safe to re-run after build_templates.py / wec666_patch.py."""
import pathlib
MARK = '<!-- WEC-910 document type -->'
ROW = '''{MARK}
    {{% if event.document_type and event.invoice_type != "invoice" %}}
    <tr>
      <td class="pad-side" style="padding:14px 48px 0 48px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:'Geologica',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <tr>
            <td align="left"  style="font-size:14px; font-weight:700; color:#004636;">{LABEL}</td>
            <td align="right" style="font-size:14px; font-weight:400; color:#004636;">{{{{ event.document_type }}}}</td>
          </tr>
        </table>
      </td>
    </tr>
    {{% endif %}}
'''
ANCHOR = '    {% if event.invoice_type == "invoice" %}'
here = pathlib.Path(__file__).parent
for folder in ('out', 'klaviyo'):
    for lang, label in (('el', 'Παραστατικό'), ('en', 'Document')):
        p = here / folder / f'01_order_confirmation_{lang}.html'
        s = p.read_text(encoding='utf-8')
        if MARK in s:
            print('already patched', p); continue
        assert s.count(ANCHOR) == 1, p
        s = s.replace(ANCHOR, ROW.format(MARK=MARK, LABEL=label) + ANCHOR)
        p.write_text(s, encoding='utf-8'); print('patched', p)
