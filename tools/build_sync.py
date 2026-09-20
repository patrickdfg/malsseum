# -*- coding: utf-8 -*-
"""말씀 녹음의 '문단별 시작 시각'을 만들어 audio/sync.json 에 넣는다.

녹음을 받아쓴 뒤(Whisper) 원고에 시간을 맞춰 붙여(align) 문단마다 시작 시각을 얻는다.
뷰어는 재생 위치를 보고 지금 읽고 있는 문단을 짚어 준다. 이게 없으면 소리는 나는데
화면이 안 따라간다.

쓰는 법:
    python tools/build_sync.py            # 시간표 없는 편 전부
    python tools/build_sync.py 35         # 그 편만 (편 번호 no)
    python tools/build_sync.py --model small 35
    (SAYEON_PASS 필요. 처음 한 번 pip install faster-whisper)

**이미 만들어 둔 편은 건너뛴다.** 녹음을 새로 넣은 뒤 다시 돌려도 그 편만 처리한다.
같은 편을 다시 만들려면 sync.json 에서 그 항목을 지우고 돌린다.

sayeon 저장소에도 같은 이름의 도구가 있는데, 그쪽은 말씀이 `sayeon/malsseum/` 아래
있던 옛 구조를 본다. 2026-09-14 에 저장소가 갈라졌으므로 말씀은 이 파일로 만든다.
받아쓴 중간 결과는 `.seg_cache/` 에 남아 다시 돌려도 아낀다(저장소에는 안 올린다).
"""
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import align  # noqa: E402
import crypt  # noqa: E402

REPO = crypt.REPO
DATA = os.path.join(REPO, 'malsseum.json')
OUT = os.path.join(REPO, 'audio', 'sync.json')
CACHE = os.path.join(REPO, '.seg_cache')


def transcribe(model_size, audio, seg_path):
    """받아쓰기. 한 번 받아쓴 편은 .seg_cache 에 두고 다시 쓴다."""
    if os.path.exists(seg_path):
        return json.load(io.open(seg_path, encoding='utf-8')), None
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device='cpu', compute_type='int8', cpu_threads=6)
    start = time.time()
    gen, info = model.transcribe(audio, language='ko', vad_filter=True,
                                 vad_parameters={'min_silence_duration_ms': 400})
    segs = [{'s': round(x.start, 2), 'e': round(x.end, 2), 't': x.text.strip()}
            for x in gen]
    io.open(seg_path, 'w', encoding='utf-8', newline='').write(
        json.dumps(segs, ensure_ascii=False))
    took = time.time() - start
    return segs, '%.1f분 → %.0f초 (%.1f배속)' % (
        info.duration / 60, took, info.duration / max(took, 0.01))


def main(args):
    model_size = 'base'
    if '--model' in args:
        at = args.index('--model')
        model_size = args[at + 1]
        args = args[:at] + args[at + 2:]
    wanted = {str(a) for a in args if not a.startswith('-')}

    os.makedirs(CACHE, exist_ok=True)
    sync = json.load(io.open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    data = crypt.read_json(DATA)

    todo = []
    for entry in data:
        no = str(entry['no'])
        if not entry.get('audio'):
            continue
        if wanted and no not in wanted:
            continue
        # 뷰어는 음성 파일 이름(0920)을 먼저 찾고 없으면 편 번호를 본다 — 둘 다 없을 때만 만든다
        stem = os.path.splitext(os.path.basename(entry['audio']))[0]
        if not wanted and (no in sync or stem in sync):
            continue
        todo.append(entry)

    if not todo:
        print('시간표를 만들 편이 없습니다.')
        return
    print('대상 %d편: %s' % (len(todo), ', '.join(e['short'] for e in todo)))

    made = 0
    for entry in todo:
        no = str(entry['no'])
        audio = os.path.join(REPO, entry['audio'])
        if not os.path.exists(audio):
            print('  %s %s: 음성 파일이 없습니다 (%s)' % (no, entry['short'], entry['audio']))
            continue
        segs, took = transcribe(model_size, audio, os.path.join(CACHE, 'mal%s.json' % no))
        if took:
            print('  %s %s: 받아쓰기 %s' % (no, entry['short'], took))
        times = align.align(entry, segs)
        if not times:
            # 정렬 실패는 대개 녹음이 그 편의 원고와 다르다는 신호다 (파일을 잘못 넣은 경우)
            print('  %s %s: 맞추지 못했습니다 — 녹음과 원고가 같은 편인지 보세요' % (no, entry['short']))
            continue
        sync[no] = times
        made += 1
        print('  %s %s: 문단 %d개, 마지막 %.1f초' % (no, entry['short'], len(times), times[-1]))

    if not made:
        print('새로 만든 시간표가 없습니다.')
        return
    io.open(OUT, 'w', encoding='utf-8', newline='').write(
        json.dumps(sync, ensure_ascii=False, separators=(',', ':')))
    print('저장: audio/sync.json (%d편, 이번에 %d편 추가)' % (len(sync), made))


if __name__ == '__main__':
    main(sys.argv[1:])
