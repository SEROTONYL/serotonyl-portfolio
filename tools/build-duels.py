# собирает /duels из моих старых дуэлей: картинки (taste/duels, duels2) и звук (music-taste)
# python3 tools/build-duels.py  (из корня репо)
import json, os, re, subprocess

HOME = os.path.expanduser('~')
OUT = 'duels'
os.makedirs(f'{OUT}/img', exist_ok=True)
os.makedirs(f'{OUT}/snd', exist_ok=True)

def ff(*args):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)

def pairs(log):
    # только первые показы, повторы выкидываем
    return [[x['a'], x['b'], x['win']] for x in log if not x['rep']]

data = {'img': {'items': {}, 'pairs': []}, 'snd': {'items': {}, 'pairs': []}}

for ans, pool in [('duels-answers.json', 'duels'), ('duels2-answers.json', 'duels2')]:
    d = json.load(open(f'{HOME}/Downloads/{ans}'))
    js = open(f'{HOME}/dev/taste/{pool}/pool.js').read()
    srcs = dict(re.findall(r'"id": "(\w+)", "src": "([^"]+)"', js))
    for p in d['pool']:
        i = p['id']
        dst = f'{OUT}/img/{i}.webp'
        if not os.path.exists(dst):
            src = os.path.normpath(f'{HOME}/dev/taste/{pool}/{srcs[i]}')
            ff('-i', src, '-vf', "scale='min(900,iw)':-2", '-q:v', '78', dst)
        data['img']['items'][i] = p['t']
    data['img']['pairs'] += pairs(d['log'])

d = json.load(open(f'{HOME}/dev/music-taste/answers-2026-09-01.json'))
js = open(f'{HOME}/dev/music-taste/pool.js').read()
titles = {x['id']: x['t'] for x in json.loads(js[js.index('['):js.rindex(']') + 1])}
for a, b, w in pairs(d['log']):
    for i in (a, b):
        dst = f'{OUT}/snd/{i}.m4a'
        if not os.path.exists(dst):
            ff('-i', f'{HOME}/dev/music-taste/snippets/{i}.m4a', '-vn', '-c:a', 'aac', '-b:a', '96k', dst)
        data['snd']['items'][i] = titles[i]
    data['snd']['pairs'].append([a, b, w])

with open(f'{OUT}/data.js', 'w') as f:
    f.write('const DATA=' + json.dumps(data, ensure_ascii=False) + ';\n')
print({k: (len(v['items']), len(v['pairs'])) for k, v in data.items()})
