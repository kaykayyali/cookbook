from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'docs' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

def make(size, filename):
    image = Image.new('RGB', (size, size), '#1C1917')
    draw = ImageDraw.Draw(image)
    pad = size * 0.17
    draw.rounded_rectangle((pad, pad, size-pad, size-pad), radius=size*0.12, fill='#F8F1E7', outline='#E97A47', width=max(3, size//45))
    left, top, right, bottom = size*.31, size*.29, size*.69, size*.70
    draw.rounded_rectangle((left, top, right, bottom), radius=size*.035, outline='#1C1917', width=max(3, size//36))
    for y in (.40, .49, .58):
        draw.line((size*.38, size*y, size*.62, size*y), fill='#E97A47', width=max(3, size//50))
    draw.arc((size*.40, size*.61, size*.60, size*.78), 195, 345, fill='#E97A47', width=max(3, size//45))
    image.save(OUT / filename, optimize=True)

make(192, 'icon-192.png')
make(512, 'icon-512.png')
make(180, 'apple-touch-icon.png')
