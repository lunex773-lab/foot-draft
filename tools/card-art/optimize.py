"""Optimizes the rendered card images (256-colour palette with dithering).

    python3 tools/card-art/optimize.py [directory]   # default: assets/cards

Requires Pillow. Keeps the visual result while making each card ~30 KB
(similar to the original card images of the player database).
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'assets', 'cards')
total_before = total_after = 0
for name in sorted(os.listdir(target)):
    if not name.endswith('.png'):
        continue
    path = os.path.join(target, name)
    total_before += os.path.getsize(path)
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(path, 'PNG', optimize=True)
    total_after += os.path.getsize(path)
print(f'optimized {target}: {total_before / 1e6:.1f} MB -> {total_after / 1e6:.1f} MB')
