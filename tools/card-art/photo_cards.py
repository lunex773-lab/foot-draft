"""Builds the photorealistic player cards.

    python3 tools/card-art/photo_cards.py [FD-001 FD-002 ...] [--out DIR]

Input : data/player-db-v1/cards/<id>.png      original card (frame, generic silhouette)
        data/player-db-v1/portraits/<id>.jpg  AI-generated portrait (square, head & shoulders)
        data/player-db-v1/players.json        name, OVR, position, stats, rarity
Output: assets/cards/<id>.png (256-colour optimized)

Card = the original frame + the portrait filling the interior (no silhouette)
+ OVR, position, name, the six stats, rarity label and footer drawn in the
same font, sizes and colours as the original cards. Requires Pillow + numpy.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, 'data', 'player-db-v1')
CARDS = os.path.join(DB, 'cards')
PORTRAITS = os.path.join(DB, 'portraits')
OUT = os.path.join(ROOT, 'assets', 'cards')

W, H = 512, 680
SS = 4
FONT_BOLD = 'DejaVuSans-Bold.ttf'
FONT = 'DejaVuSans.ttf'

# interior of the card: just inside the thin inner line of the original frame
_LEFT = [(240, 49), (183, 68), (127, 51), (63, 73), (62, 550), (52, 566), (64, 581), (101, 613)]
INTERIOR = [(256, 44)] + [(512 - x, y) for x, y in _LEFT] + [(256, 636)] + list(reversed(_LEFT))

PHOTO = {'size': 440, 'top': 46}
STAT_X = [70, 145, 220, 295, 370, 445]

# colours sampled from the original card templates
STYLE = {
    'common': {'ovr': (240, 241, 244), 'accent': (200, 204, 212), 'bg': (35, 38, 45)},
    'rare': {'ovr': (245, 247, 252), 'accent': (79, 155, 255), 'bg': (11, 34, 75)},
    'epic': {'ovr': (247, 244, 252), 'accent': (186, 120, 255), 'bg': (45, 15, 75)},
    'legendary': {'ovr': (255, 202, 75), 'accent': (255, 202, 75), 'bg': (41, 29, 11)},
    'icon': {'ovr': (255, 236, 176), 'accent': (255, 236, 176), 'bg': (34, 49, 57)},
}
FOOTER = (205, 205, 210)
SHADOW = (5, 6, 8)


def interior_mask():
    m = Image.new('L', (W * SS, H * SS), 0)
    ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in INTERIOR], fill=255)
    return m.resize((W, H), Image.LANCZOS)


def vertical(y0, y1, a0, a1):
    """alpha ramp (0..255) between rows y0 and y1"""
    col = np.zeros(H, dtype=np.float32)
    col[:y0] = a0
    col[y1:] = a1
    if y1 > y0:
        t = np.linspace(0, 1, y1 - y0, dtype=np.float32)
        col[y0:y1] = a0 + (a1 - a0) * (t * t * (3 - 2 * t))
    return np.repeat(col[:, None], W, axis=1)


def background(style, photo_bg):
    """dark gradient from the photo's studio background to the rarity colour"""
    top = np.array(photo_bg, dtype=np.float32)
    bottom = np.array(style['bg'], dtype=np.float32)
    t = vertical(380, 640, 0, 1)[..., None]
    img = top * (1 - t) + bottom * t
    return Image.fromarray(img.clip(0, 255).astype(np.uint8)).convert('RGBA')


def text(draw, xy, s, font, fill, anchor, shadow=2):
    if shadow:
        draw.text((xy[0] + shadow * 0.6, xy[1] + shadow), s, font=font, fill=SHADOW + (200,), anchor=anchor)
    draw.text(xy, s, font=font, fill=fill + (255,), anchor=anchor)


def compose(player, mask, fonts):
    rarity = player['rarity'].lower()
    style = STYLE[rarity]
    card = Image.open(os.path.join(CARDS, f"{player['id']}.png")).convert('RGBA')
    photo = Image.open(os.path.join(PORTRAITS, f"{player['id']}.jpg")).convert('RGB')
    s = PHOTO['size']
    photo = photo.resize((s, s), Image.LANCZOS)
    # studio background colour = average of the photo's top corners
    pa = np.asarray(photo, dtype=np.float32)
    photo_bg = tuple(int(v) for v in np.concatenate([pa[:40, :40].reshape(-1, 3), pa[:40, -40:].reshape(-1, 3)]).mean(axis=0))

    inner = background(style, photo_bg)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(photo.convert('RGBA'), ((W - s) // 2, PHOTO['top']))
    fade = Image.fromarray(vertical(PHOTO['top'] + s - 120, PHOTO['top'] + s - 8, 255, 0).astype(np.uint8))
    layer.putalpha(Image.fromarray(np.minimum(np.asarray(layer.split()[3]), np.asarray(fade))))
    inner = Image.alpha_composite(inner, layer)
    # darken the lower part for the name and stats
    shade = Image.new('RGBA', (W, H), SHADOW + (0,))
    shade.putalpha(Image.fromarray(vertical(400, 520, 0, 150).astype(np.uint8)))
    inner = Image.alpha_composite(inner, shade)

    d = ImageDraw.Draw(inner)
    text(d, (63, 142), str(player['overall']), fonts['ovr'], style['ovr'], 'ls', 3)
    text(d, (69, 172), player['primary_position'], fonts['pos'], style['accent'], 'ls', 2)
    text(d, (256, 510), player['name'].upper(), fonts['name'], (255, 255, 255), 'ms', 2)
    for x, key in zip(STAT_X, ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY']):
        text(d, (x, 553), key, fonts['label'], style['accent'], 'ms', 1)
        text(d, (x, 582), str(player['display_stats'][key]), fonts['value'], (245, 245, 245), 'ms', 1)
    text(d, (256, 621), rarity.upper(), fonts['rarity'], style['accent'], 'ms', 2)
    text(d, (256, 643), 'FOOTBALL DRAFT', fonts['footer'], FOOTER, 'ms', 0)

    out = card.copy()
    out.paste(inner, (0, 0), mask)
    return out.convert('RGB')


def main():
    args = sys.argv[1:]
    out_dir = OUT
    if '--out' in args:
        i = args.index('--out')
        out_dir = args[i + 1]
        args = args[:i] + args[i + 2:]
    players = {p['id']: p for p in json.load(open(os.path.join(DB, 'players.json')))['players']}
    ids = args or sorted(f[:-4] for f in os.listdir(PORTRAITS) if f.endswith('.jpg'))
    os.makedirs(out_dir, exist_ok=True)
    fonts = {
        'ovr': ImageFont.truetype(FONT_BOLD, 62),
        'pos': ImageFont.truetype(FONT_BOLD, 28),
        'name': ImageFont.truetype(FONT_BOLD, 29),
        'label': ImageFont.truetype(FONT, 12),
        'value': ImageFont.truetype(FONT, 17),
        'rarity': ImageFont.truetype(FONT_BOLD, 29),
        'footer': ImageFont.truetype(FONT, 12),
    }
    mask = interior_mask()
    for card_id in ids:
        img = compose(players[card_id], mask, fonts)
        img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(os.path.join(out_dir, f'{card_id}.png'), 'PNG', optimize=True)
    print(f'built {len(ids)} cards -> {out_dir}')


if __name__ == '__main__':
    main()
