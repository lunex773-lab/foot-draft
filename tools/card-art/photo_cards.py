"""Composites the photorealistic portraits onto the player cards.

    python3 tools/card-art/photo_cards.py [FD-001 FD-002 ...] [--out DIR]

Input : data/player-db-v1/cards/<id>.png      original card (generic silhouette)
        data/player-db-v1/portraits/<id>.jpg  AI-generated portrait (square, head & shoulders)
Output: assets/cards/<id>.png (256-colour optimized)

The portrait replaces the silhouette exactly (head circle + body shape of the
original card design); the rarity-coloured ring is redrawn on top and the
original name / stats / rarity label are kept. Requires Pillow.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CARDS = os.path.join(ROOT, 'data', 'player-db-v1', 'cards')
PORTRAITS = os.path.join(ROOT, 'data', 'player-db-v1', 'portraits')
OUT = os.path.join(ROOT, 'assets', 'cards')

SS = 4  # supersampling for smooth edges
W, H = 512, 680
RING = (256, 241, 84)  # centre x, centre y, radius of the portrait window (covers the original ring r~76)
BODY = [(100, 492), (126, 333), (205, 291), (307, 291), (386, 333), (412, 492)]
NAME_TOP = 488
PHOTO = {'size': 362, 'top': 126}  # square portrait placement
NAVY = (16, 24, 34)
RING_COLOR = {
    'common': (170, 174, 182),
    'rare': (64, 134, 223),
    'epic': (166, 93, 223),
    'legendary': (222, 177, 68),
    'icon': (222, 209, 158),
}


def window_mask_ss():
    m = Image.new('L', (W * SS, H * SS), 0)
    d = ImageDraw.Draw(m)
    cx, cy, r = RING
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=255)
    d.polygon([(x * SS, y * SS) for x, y in BODY], fill=255)
    return m


def window_mask():
    return window_mask_ss().resize((W, H), Image.LANCZOS)


def outline_layer(color):
    """rarity-coloured outline around the portrait window (ring + body), like the original silhouette"""
    m = window_mask_ss()
    inner = m.filter(ImageFilter.MinFilter(3 * SS + 1))
    edge = Image.fromarray(np.clip(np.asarray(m, dtype=np.int16) - np.asarray(inner, dtype=np.int16), 0, 255).astype(np.uint8))
    layer = Image.new('RGBA', (W * SS, H * SS), color + (0,))
    layer.putalpha(edge)
    return layer.resize((W, H), Image.LANCZOS)


def tint_background(photo):
    """pull the near-black studio background towards the navy of the original silhouette"""
    a = np.asarray(photo.convert('RGB'), dtype=np.float32)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    w = np.clip((55 - lum) / 35, 0, 1) * np.clip((28 - sat) / 22, 0, 1)
    out = a * (1 - w[..., None] * 0.85) + np.array(NAVY, dtype=np.float32) * (w[..., None] * 0.85)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert('RGBA')


def bottom_fade():
    fade = Image.new('RGBA', (W, H), NAVY + (0,))
    px = fade.load()
    for y in range(400, NAME_TOP + 6):
        a = int(235 * min(1, (y - 400) / (NAME_TOP - 400)) ** 1.6)
        for x in range(W):
            px[x, y] = NAVY + (a,)
    return fade


def rarity_of(card_id, players):
    return players[card_id]['rarity'].lower()


def compose(card_id, rarity, mask, fade, outlines):
    outline = outlines[rarity]
    card = Image.open(os.path.join(CARDS, f'{card_id}.png')).convert('RGBA')
    photo = Image.open(os.path.join(PORTRAITS, f'{card_id}.jpg')).convert('RGBA')
    s = PHOTO['size']
    photo = tint_background(photo.resize((s, s), Image.LANCZOS))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(photo, ((W - s) // 2, PHOTO['top']))
    layer = Image.alpha_composite(layer, Image.new('RGBA', (W, H), (0, 0, 0, 0)))
    # fade the lower body into the dark band behind the name
    layer = Image.alpha_composite(layer, Image.composite(fade, Image.new('RGBA', (W, H), (0, 0, 0, 0)), layer.split()[3]))
    out = card.copy()
    out.paste(layer, (0, 0), Image.composite(layer, Image.new('RGBA', (W, H), (0, 0, 0, 0)), mask).split()[3])
    out = Image.alpha_composite(out, outline)
    # restore the original name / stats / rarity label
    out.paste(card.crop((0, NAME_TOP, W, H)), (0, NAME_TOP))
    return out.convert('RGB')


def main():
    import json

    args = sys.argv[1:]
    out_dir = OUT
    if '--out' in args:
        i = args.index('--out')
        out_dir = args[i + 1]
        args = args[:i] + args[i + 2:]
    players = {p['id']: p for p in json.load(open(os.path.join(ROOT, 'data', 'player-db-v1', 'players.json')))['players']}
    ids = args or sorted(f[:-4] for f in os.listdir(PORTRAITS) if f.endswith('.jpg'))
    os.makedirs(out_dir, exist_ok=True)
    mask = window_mask()
    fade = bottom_fade()
    outlines = {r: outline_layer(c) for r, c in RING_COLOR.items()}
    for card_id in ids:
        img = compose(card_id, rarity_of(card_id, players), mask, fade, outlines)
        img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(os.path.join(out_dir, f'{card_id}.png'), 'PNG', optimize=True)
    print(f'composited {len(ids)} cards -> {out_dir}')


if __name__ == '__main__':
    main()
