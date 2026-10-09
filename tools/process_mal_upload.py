# -*- coding: utf-8 -*-
"""앱에서 올린 말씀 원고(HWP)와 녹음(mp3)을 말씀 자료에 넣는다.

앱(`/sayeon/upload/`)이 `mal-upload/<묶음>/` 에 올려 둔 것을 처리한다.
  script.hwp            원고
  audio.mp3.part000 …   녹음 조각(합치면 mp3 하나)
  job.json              작업표 — 맨 나중에 올라와 이 일을 깨운다

하는 일
  1. 녹음 조각을 합쳐 SHA-256 을 맞춰 보고 mp3 인지 본다.
  2. 원고 머리글에서 날짜를 읽어 `audio/MMDD.mp3` 로 정하고 편 번호를 매긴다(없으면 다음 번호).
  3. 25MB 가 넘는 녹음은 48kbps 모노로 줄인다.
  4. 같은 날 같은 말씀이 이미 있으면 멈춘다(교체는 작업표에 `replace` 를 넣었을 때만).
  5. 원고를 잠긴 자료(malsseum.json.enc)에 넣고, 처리한 묶음 폴더를 지운다.

작업표(job.json)
  {"hwp": "script.hwp", "parts": ["audio.mp3.part000", ...], "sha256": "...", "size": 123,
   "join": false, "replace": false, "no": null, "dry_run": false}

SAYEON_PASS 환경변수가 필요하다. 깃허브 일꾼에서는 저장소 비밀값으로 받는다.
끝나면 편 번호를 GITHUB_OUTPUT 의 `no` 로 내보내 시간표 단계가 쓴다.
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt as content_crypt  # noqa: E402
import import_malsseum_hwp as importer  # noqa: E402

ROOT = importer.ROOT
INBOX = os.path.join(ROOT, 'mal-upload')
DATA = importer.DATA_PATH           # 실제 파일은 malsseum.json.enc (잠겨 있다)
SHRINK_ABOVE = 25 * 1024 * 1024     # 이보다 크면 48kbps 모노로 줄인다
OLD_FROM = 1000                     # 옛 말씀(2020~2023)은 번호가 1000부터


def say(text):
    print(text, flush=True)


def set_output(key, value):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path, 'a', encoding='utf-8') as out:
            out.write('%s=%s\n' % (key, value))


def assemble(folder, job):
    """녹음 조각을 합쳐 mp3 하나로 만든다. 합친 파일 경로를 돌려준다."""
    parts = job.get('parts') or []
    if not parts:
        raise ValueError('녹음 조각이 없습니다.')
    target = os.path.join(folder, 'audio.mp3')
    digest = hashlib.sha256()
    total = 0
    with open(target, 'wb') as out:
        for name in parts:
            path = os.path.join(folder, os.path.basename(name))
            if not os.path.exists(path):
                raise ValueError('녹음 조각이 빠졌습니다: %s' % name)
            data = open(path, 'rb').read()
            out.write(data)
            digest.update(data)
            total += len(data)
    if job.get('size') and int(job['size']) != total:
        raise ValueError('녹음 크기가 다릅니다 (%d != %d)' % (total, int(job['size'])))
    if job.get('sha256') and job['sha256'] != digest.hexdigest():
        raise ValueError('녹음 SHA-256 이 다릅니다. 올리다가 깨졌을 수 있으니 다시 올려 주세요.')
    head = open(target, 'rb').read(3)
    if not (head == b'ID3' or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)):
        raise ValueError('mp3 파일이 아닌 것 같습니다.')
    return target


def shrink(path):
    """큰 녹음은 말소리에 맞게 48kbps 모노로 줄인다. 줄인 게 더 크면 원본을 둔다."""
    size = os.path.getsize(path)
    if size <= SHRINK_ABOVE:
        say('녹음 %dMB — 줄이지 않음' % (size // 1048576))
        return
    small = path + '.small.mp3'
    say('녹음 %dMB — 48kbps 모노로 줄입니다' % (size // 1048576))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1',
                    '-ar', '44100', '-b:a', '48k', small], check=True)
    if os.path.getsize(small) < size:
        shutil.move(small, path)
        say('  -> %dMB' % (os.path.getsize(path) // 1048576))
    else:
        os.remove(small)
        say('  원본이 더 작아 그대로 둡니다')


def next_number(data):
    """편 번호는 날짜 순서로 이어진다(1~12, 33~40 …, 올해 앞부분은 100번대).
    그래서 가장 큰 번호가 아니라 '날짜가 가장 늦은 편'의 다음 번호를 쓴다. 이미 있으면 건너뛴다."""
    live = [item for item in data if item['no'] < OLD_FROM]
    last = max(live, key=lambda item: tuple(map(int, item['short'].split('/'))))
    used = {item['no'] for item in data}
    number = last['no'] + 1
    while number in used:
        number += 1
    return number


def process(folder):
    with open(os.path.join(folder, 'job.json'), encoding='utf-8-sig') as stream:
        job = json.load(stream)
    hwp = os.path.join(folder, os.path.basename(job.get('hwp') or 'script.hwp'))
    if not os.path.exists(hwp):
        raise ValueError('원고(HWP)가 없습니다.')
    replace, dry_run = bool(job.get('replace')), bool(job.get('dry_run'))

    audio_tmp = assemble(folder, job)
    # 번호는 아직 모르니 임시로 0 을 넣어 날짜·제목만 읽는다
    entry, (month, day) = importer.make_entry(hwp, 0, None, bool(job.get('join')))
    stem = '%02d%02d' % (month, day)
    audio_rel = 'audio/%s.mp3' % stem

    data = content_crypt.read_json(DATA)
    same = [item for item in data if item['title'] == entry['title']]
    used = [item for item in data if item.get('audio') == audio_rel and item['title'] != entry['title']]
    if used:
        raise ValueError('%s 는 다른 말씀(%s)이 쓰고 있어 덮어쓸 수 없습니다.' % (audio_rel, used[0]['title']))
    if same and not replace:
        raise ValueError('"%s" 이(가) 이미 있습니다(번호 %s). 교체하려면 replace 가 필요합니다.' %
                         (entry['title'], same[0]['no']))
    if job.get('no'):
        number = int(job['no'])
        if any(item['no'] == number and item['title'] != entry['title'] for item in data):
            raise ValueError('번호 %d 는 다른 말씀이 쓰고 있습니다.' % number)
    elif same:
        number = same[0]['no']          # 교체는 번호를 그대로 둔다
    else:
        number = next_number(data)
    entry['no'] = number
    entry['audio'] = audio_rel

    say('말씀 %s → 번호 %d, 음성 %s, 블록 %d개%s' % (
        entry['title'], number, audio_rel, len(entry['paragraphs']),
        ' (교체)' if same else ''))
    if dry_run:
        say('시험 실행이라 자료에 넣지 않습니다.')
        shutil.rmtree(folder)
        set_output('no', '')
        return

    shrink(audio_tmp)
    os.makedirs(os.path.join(ROOT, 'audio'), exist_ok=True)
    shutil.move(audio_tmp, os.path.join(ROOT, audio_rel))
    data = [item for item in data if item['title'] != entry['title']]
    data.append(entry)
    data.sort(key=lambda item: tuple(map(int, item['short'].split('/'))))
    content_crypt.write_json(DATA, data, indent=1)
    shutil.rmtree(folder)
    say('말씀 자료에 넣었습니다 (모두 %d편).' % len(data))
    set_output('no', str(number))
    set_output('stem', stem)


def main(args):
    folders = [os.path.dirname(p) for p in
               (args if args else sorted(glob.glob(os.path.join(INBOX, '*', 'job.json'))))]
    if not folders:
        raise SystemExit('처리할 mal-upload/*/job.json 이 없습니다.')
    for folder in folders:
        folder = folder if os.path.isabs(folder) else os.path.join(ROOT, folder)
        try:
            process(folder)
        except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
            # 깃허브 화면의 표시 줄에 이유가 한 줄로 보이게 한다
            print('::error::%s' % error)
            raise SystemExit(1)


if __name__ == '__main__':
    main(sys.argv[1:])
