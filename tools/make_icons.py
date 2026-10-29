"""Draw the pixel-penguin app icons into ../icons/. Run: python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

PENGUIN = [
    '.....ww.....', '....bbbb....', '...bbbbbb...', '..kkkkkkkk..', '.kkwwwwwwkk.',
    '.kwkwwwwkwk.', '.kwwwoowwwk.', '.kpwwwwwwpk.', 'rrrrrrrrrrr.', 'kkwwwwwwwkkr',
    'kkwwwwwwwkk.', '.kwwwwwwwk..', '..kkkkkkk...', '..oo...oo...', 'rrrrrrrrrrrr']
PAL = {'k': '#24264a', 'w': '#ffffff', 'o': '#ff9f43', 'b': '#4aa3ff', 'r': '#ff5f87', 'p': '#ffb3c7'}
SKY, SNOW, LINE = '#bfe5ff', '#ffffff', '#2a2c55'
OUT = Path(__file__).resolve().parent.parent / 'icons'


def icon(size, scale, snow_frac=0.2):
    img = Image.new('RGB', (size, size), SKY)
    d = ImageDraw.Draw(img)
    ground = int(size * (1 - snow_frac))
    d.rectangle([0, ground, size, size], fill=SNOW)
    d.rectangle([0, ground, size, ground + max(2, size // 64)], fill=LINE)
    w, h = len(PENGUIN[0]) * scale, len(PENGUIN) * scale
    x0 = (size - w) // 2
    y0 = ground - h + scale  # skis rest on the snow line
    for j, row in enumerate(PENGUIN):
        for i, c in enumerate(row):
            if c != '.':
                d.rectangle([x0 + i * scale, y0 + j * scale, x0 + (i + 1) * scale - 1, y0 + (j + 1) * scale - 1], fill=PAL[c])
    return img


OUT.mkdir(exist_ok=True)
icon(192, 10).save(OUT / 'icon-192.png')
icon(512, 26).save(OUT / 'icon-512.png')
icon(512, 18, snow_frac=0.28).save(OUT / 'icon-maskable-512.png')  # stays inside the 80% safe zone
icon(180, 9).save(OUT / 'apple-touch-icon.png')
print('icons written to', OUT)
