#!/usr/bin/env python3
"""Genera, para cada marca, su página con vista previa propia (título e imagen) y la imagen 1200x630.
WhatsApp no ejecuta JavaScript: lee solo el HTML estático, así que cada marca necesita su propio archivo.
El acceso sigue protegido por el código ?k= de cada marca; el nombre del archivo no da acceso a nada."""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(AQUI, '..', 'fonts')
SITIO = 'https://eljoint-referencias.web.app'
MARCAS = {  # archivo: (nombre, tipografía de la imagen)
    'bmw':      ('BMW',      'BMWTypeNext-Bold.otf'),
    'motorrad': ('MOTORRAD', 'BMWMotorrad-Heavy.ttf'),
    'mini':     ('MINI',     'FreudianTwo.woff'),
    'byd':      ('BYD',      'FreudianTwo.woff'),
}

def imagen(marca, nombre, fuente):
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), (10, 10, 11))
    d = ImageDraw.Draw(im)
    size = 330
    while True:  # el nombre ocupa el ancho disponible
        f = ImageFont.truetype(os.path.join(FONTS, fuente), size)
        x0, y0, x1, y1 = d.textbbox((0, 0), nombre, font=f)
        if x1 - x0 <= W - 160 or size < 80: break
        size -= 6
    d.text(((W - (x1 - x0)) / 2 - x0, (H - (y1 - y0)) / 2 - y0 - 20), nombre, font=f, fill=(255, 255, 255))
    pq = ImageFont.truetype(os.path.join(FONTS, 'BMWTypeNext-Regular.otf'), 30)
    t = 'REFERENCIAS  ·  EL JOINT'
    b = d.textbbox((0, 0), t, font=pq)
    d.text(((W - (b[2] - b[0])) / 2, H - 90), t, font=pq, fill=(225, 251, 82))
    os.makedirs(os.path.join(AQUI, 'og'), exist_ok=True)
    im.save(os.path.join(AQUI, 'og', marca + '.png'), optimize=True)

def pagina(marca, nombre, base):
    meta = f'''<title>Referencias {nombre} · El Joint</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="El Joint">
<meta property="og:title" content="Referencias {nombre} · El Joint">
<meta property="og:description" content="Ideas para contenido orgánico. Revisa, aprueba y comenta.">
<meta property="og:image" content="{SITIO}/og/{marca}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">'''
    out, n = re.subn(r'<title>.*?</title>', meta, base, count=1, flags=re.S)
    assert n == 1, 'no encontré <title> en presentacion.html'
    return out

if __name__ == '__main__':
    destino = sys.argv[1]  # carpeta public/
    base = open(os.path.join(AQUI, '..', 'presentacion.html'), encoding='utf-8').read()
    os.makedirs(os.path.join(destino, 'og'), exist_ok=True)
    for marca, (nombre, fuente) in MARCAS.items():
        imagen(marca, nombre, fuente)
        open(os.path.join(destino, marca + '.html'), 'w', encoding='utf-8').write(pagina(marca, nombre, base))
        os.replace(os.path.join(AQUI, 'og', marca + '.png'), os.path.join(destino, 'og', marca + '.png'))
        print('ok', marca)
