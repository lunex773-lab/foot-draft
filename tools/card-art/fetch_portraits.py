"""Downloads generated portraits from Figma and records them.

    python3 tools/card-art/fetch_portraits.py FD-002=<asset-id>@<node-id> [...]

<asset-id> is the id in https://www.figma.com/api/mcp/asset/<asset-id>.png
(the URL is valid for 7 days). Saves data/player-db-v1/portraits/<id>.jpg
(640 x 640) and adds the entry to data/player-db-v1/portraits.json.
"""
import io
import json
import os
import subprocess
import sys
import time
from datetime import date

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, 'data', 'player-db-v1')
MANIFEST = os.path.join(DB, 'portraits.json')

manifest = json.load(open(MANIFEST))
ok = []
for arg in sys.argv[1:]:
    card_id, rest = arg.split('=', 1)
    asset, node = rest.split('@', 1)
    url = f'https://www.figma.com/api/mcp/asset/{asset}.png'
    try:
        for attempt in range(6):  # a new image can take a few seconds to become available
            data = subprocess.run(['curl', '-sS', '-f', '-L', '--max-time', '60', url], capture_output=True).stdout
            if data[:8] == b'\x89PNG\r\n\x1a\n':
                break
            time.sleep(10)
        else:
            raise RuntimeError(f'not a PNG ({len(data)} bytes)')
        Image.open(io.BytesIO(data)).convert('RGB').resize((640, 640), Image.LANCZOS).save(os.path.join(DB, 'portraits', f'{card_id}.jpg'), quality=90, optimize=True)
        manifest['players'][card_id] = {'model': 'gpt-image-2.5-flare', 'figma_node': node, 'generated_at': date.today().isoformat()}
        ok.append(card_id)
    except Exception as e:  # noqa: BLE001
        print(f'FAILED {card_id}: {e}')
manifest['players'] = dict(sorted(manifest['players'].items()))
json.dump(manifest, open(MANIFEST, 'w'), indent=1)
print(f'saved {len(ok)}: {" ".join(ok)} (total {len(manifest["players"])})')
