#!/usr/bin/env python3
"""Склейка пяти экранов в одну страницу, 12.10.2026 (BACKLOG, пункт 4).

Разовый инструмент: читает черновики экранов и пишет index.html.
Стили каждого экрана получают приставку своей секции (#s1 ... #s5),
html/body/:root экрана становятся самой секцией. Скрипты обёрнуты
каждый в свою функцию с ROOT = секция, document.querySelector смотрит
только в неё. Клавиши-лаборатория работают только с ?lab в адресе.
"""
import re, sys, pathlib

D = pathlib.Path(__file__).resolve().parent.parent
SCREENS = [
    ('s1', 'hero-mockups.html',    'первый экран'),
    ('s2', 'screen2-motion.html',  'второй экран'),
    ('s3', 'screen3-column.html',  'третий экран: устройства'),
    ('s4', 'screen4-ryad.html',    'четвёртый экран: покупка'),
    ('s5', 'screen5-support.html', 'пятый экран: поддержка'),
]

# ── CSS ──────────────────────────────────────────────────────────
def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)

def blocks(css):
    """Верхний уровень: [(prelude, body)] с учётом вложенных скобок."""
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        depth, k = 1, j + 1
        while depth:
            c = css[k]
            if c == '{': depth += 1
            elif c == '}': depth -= 1
            k += 1
        out.append((css[i:j].strip(), css[j + 1:k - 1]))
        i = k
    return out

def split_sel(s):
    parts, depth, cur = [], 0, ''
    for c in s:
        if c in '([': depth += 1
        elif c in ')]': depth -= 1
        if c == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += c
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]

ROOTSEL = re.compile(r'^(html|body|:root)(?=$|[\s.:\[#>+~])')

def scope_sel(sel, sid):
    out = []
    for p in split_sel(sel):
        m = ROOTSEL.match(p)
        out.append('#' + sid + p[m.end():] if m else '#' + sid + ' ' + p)
    # html,body -> две одинаковые
    seen = []
    for x in out:
        if x not in seen: seen.append(x)
    return ','.join(seen)

def scope(css, sid, top):
    res = []
    for pre, body in blocks(css):
        if pre.startswith('@font-face') or pre.startswith('@keyframes'):
            top.append(pre + '{' + body + '}')
        elif pre.startswith('@media') or pre.startswith('@container') or pre.startswith('@supports'):
            res.append(pre + '{' + scope(body, sid, top) + '}')
        elif pre.startswith('@'):
            sys.exit('неизвестное правило: ' + pre)
        else:
            res.append(scope_sel(pre, sid) + '{' + body.strip() + '}')
    return '\n'.join(res)

# ── разбор файла ─────────────────────────────────────────────────
def parse(path):
    t = path.read_text()
    styles = re.findall(r'<style>(.*?)</style>', t, flags=re.S)
    scripts = re.findall(r'<script>(.*?)</script>', t, flags=re.S)
    m = t
    for pat in [r'<style>.*?</style>', r'<script[^>]*>.*?</script>', r'<link[^>]*>',
                r'<meta[^>]*>', r'<title>.*?</title>', r'<!doctype[^>]*>',
                r'</?html[^>]*>', r'</?head>', r'</?body>']:
        m = re.sub(pat, '', m, flags=re.S | re.I)
    return styles, scripts, m.strip()

def fix_js(js, sid):
    js = re.sub(r"document\.body\.style\.overflow = '[^']*';", '', js)
    js = js.replace('document.querySelector(', 'ROOT.querySelector(')
    js = js.replace('document.querySelectorAll(', 'ROOT.querySelectorAll(')
    js = js.replace('document.documentElement', 'ROOT')
    js = js.replace('document.body', 'ROOT')
    js = js.replace('window.__', 'ROOT.__')
    js = re.sub(r"(?m)^(\s*)addEventListener\('keydown'", r"\1LAB && addEventListener('keydown'", js)
    return js

def main():
    top, css_out, html_out, js_out = [], [], [], []
    for sid, fn, title in SCREENS:
        styles, scripts, markup = parse(D / fn)
        css = strip_comments('\n'.join(styles))
        css_out.append('/* ── ' + sid + ' · ' + fn + ' */\n' + scope(css, sid, top))
        js = '\n'.join(scripts)
        if sid == 's1':
            markup = markup.replace('<a class="headcta" href="#" onclick="return false">',
                                    '<a class="headcta" href="/account">')
        if sid == 's1':
            # Адресная строка телефона шлёт resize. Секция в svh от неё не
            # меняется, а пересчёт посреди счёта ставил барабан между цифрами.
            js = js.replace("addEventListener('resize', () => {\n  clearTimeout(rt);",
                            "let lastW = innerWidth;\naddEventListener('resize', () => {\n  if (innerWidth === lastW) return;\n  lastW = innerWidth;\n  clearTimeout(rt);")
            # Варианты в адресе нужны лаборатории, не лендингу.
            js = js.replace("  history.replaceState(null, '', '#' + variant", "  if (LAB) history.replaceState(null, '', '#' + variant")
            js = js.replace("addEventListener('hashchange'", "LAB && addEventListener('hashchange'")
            js = js.replace("const h = location.hash.slice(1);", "const h = LAB ? location.hash.slice(1) : '';")
        if sid == 's2':
            js = js.replace("addEventListener('resize', place);",
                            "let lastW = innerWidth;\naddEventListener('resize', () => { if (innerWidth !== lastW){ lastW = innerWidth; place(); } });")
            markup = markup.replace('id="frame"', 'id="frame2"')
            js = js.replace("getElementById('frame')", "getElementById('frame2')")
            js = js.replace("/[?&]wait=1/.test(location.search)", 'true')
            js = js.replace('window.__needed =', 'window.__place = place;\nwindow.__needed =')
        if sid == 's3':
            js = js.replace("new URLSearchParams(location.search).get('v') === 'preview'", 'true')
        if sid == 's4':
            js = js.replace("'oplata.html?t='", "'/pay?t='")
            js = js.replace("адрес.get('v') === 'preview'", 'true')
        if sid == 's5':
            markup = markup.replace('class="написать" href="#" onclick="return false"',
                                    'class="написать" href="/support"')
        js = fix_js(js, sid)
        html_out.append('<section class="sec" id="%s" aria-label="%s">\n%s\n</section>' % (sid, title, markup))
        js_out.append('/* ══ %s · %s */\n(function(){\nconst ROOT = document.getElementById(%r);\n%s\n})();'
                      % (sid, fn, sid, js))
    # @font-face и @keyframes без повторов
    uniq = []
    for x in top:
        if x not in uniq: uniq.append(x)
    tpl = (D / 'tools' / 'one.tpl.html').read_text()
    out = (tpl.replace('/*@@TOP@@*/', '\n'.join(uniq))
              .replace('/*@@CSS@@*/', '\n\n'.join(css_out))
              .replace('<!--@@HTML@@-->', '\n\n'.join(html_out))
              .replace('/*@@JS@@*/', '\n\n'.join(js_out)))
    (D / 'index.html').write_text(out)
    print('index.html', len(out.splitlines()), 'строк')

main()
