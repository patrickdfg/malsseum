# -*- coding: utf-8 -*-
"""소리를 -16 LUFS 로 키워 새 파일로 낸다(꼭대기는 리미터로 눌러 찢어짐을 막는다).

match_volume.py 는 -18.4 로 맞추지만 이미 꼭대기가 0 근처인 녹음은 2dB 만 더 키워도
찢어진다. 이 도구는 "키우기 → 리미터 → 잰 값이 목표가 될 때까지 되풀이" 로 맞춘다.
원본은 건드리지 않고 두 번째 경로에 새로 쓴다. 길이가 0.3초 넘게 바뀌면 멈춘다.

  python tools/loud16.py 원본 결과 [비교할_길이_파일]
"""
import re
import shutil
import subprocess
import sys

TARGET = -16.0     # 목표 소리 크기(LUFS)
CEIL = -2.0        # 꼭대기 한도(dBFS). 인코딩 뒤 조금 넘는 몫을 남긴다
FF = shutil.which('ffmpeg') or 'ffmpeg'


def run(args):
    return subprocess.run([FF, '-hide_banner', '-nostats'] + args,
                          capture_output=True, text=True, errors='replace').stderr


def chain(gain):
    lim = 10 ** (CEIL / 20.0)
    return 'volume=%.3fdB,alimiter=limit=%.4f:attack=5:release=60:level=disabled' % (gain, lim)


def measure(path, gain=None):
    """(LUFS, 샘플 꼭대기 dBFS). gain 을 주면 키우고 리미터를 건 뒤의 값을 잰다."""
    af = (chain(gain) + ',' if gain is not None else '') + 'ebur128=peak=sample:framelog=quiet'
    out = run(['-i', path, '-af', af, '-f', 'null', '-'])
    i = re.findall(r'I:\s*(-?\d+\.\d+) LUFS', out)
    p = re.findall(r'Peak:\s*(-?\d+\.\d+) dBFS', out)
    return float(i[-1]), float(p[-1])


def info(path):
    out = run(['-i', path])
    d = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', out)
    sec = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else 0.0
    b = re.search(r'Audio:.*?, (\d+) kb/s', out)
    return sec, int(b.group(1)) if b else 128


def make(src, dst, ref=None, ceil=None):
    global CEIL
    if ceil is not None:
        CEIL = ceil
    i0, p0 = measure(src)
    gain = TARGET - i0
    for _ in range(6):
        i1, _p = measure(src, gain)
        if abs(i1 - TARGET) < 0.05:
            break
        gain += TARGET - i1
    ext = dst.lower().rsplit('.', 1)[-1]
    kbps = min(info(ref or src)[1], 192)
    codec = ['-c:a', 'aac'] if ext == 'm4a' else ['-c:a', 'libmp3lame']
    # 인코딩을 거치면 잰 값이 조금 달라지므로, 결과를 다시 재서 0.1 안으로 들 때까지 고친다
    for _ in range(4):
        run(['-y', '-i', src, '-vn', '-af', chain(gain), '-b:a', '%dk' % kbps] + codec + [dst])
        i2, p2 = measure(dst)
        if abs(i2 - TARGET) <= 0.1:
            break
        gain += TARGET - i2
    sec0, sec1 = info(ref or src)[0], info(dst)[0]
    if abs(sec1 - sec0) > 0.3:
        raise SystemExit('길이가 %.2f초 바뀌어 멈춥니다: %s' % (sec1 - sec0, dst))
    return {'전': (i0, p0), '키운 값(dB)': round(gain, 2), '후': (i2, p2), '길이': (sec0, sec1)}


if __name__ == '__main__':
    r = make(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    print(r)
