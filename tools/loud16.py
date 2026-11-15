# -*- coding: utf-8 -*-
"""소리를 -16 LUFS 로 키워 새 파일로 낸다(꼭대기는 리미터로 눌러 찢어짐을 막는다).

match_volume.py 는 -18.4 로 맞추지만 이미 꼭대기가 0 근처인 녹음은 2dB 만 더 키워도
찢어진다. 이 도구는 "키우기 → 리미터 → 잰 값이 목표가 될 때까지 되풀이" 로 맞춘다.
원본은 건드리지 않고 두 번째 경로에 새로 쓴다. 길이가 0.3초 넘게 바뀌면 멈춘다.

  python tools/loud16.py 원본 결과 [비교할_길이_파일]
  python tools/loud16.py --fix 파일...   # 제자리에서 -16 으로 맞춘다(이미 맞으면 그대로)
  python tools/loud16.py --fix-new        # 아직 커밋 안 된 audio/*.mp3 만 맞춘다(자동 게시 일꾼이 쓴다)
"""
import os
import re
import shutil
import subprocess
import sys

TARGET = -16.0     # 목표 소리 크기(LUFS)
CEIL = -2.0        # 꼭대기 한도(dBFS). 인코딩 뒤 조금 넘는 몫을 남긴다


def _ffmpeg():
    """저장소 일꾼에는 ffmpeg 가 깔려 있고, 없으면 파이썬 꾸러미(imageio-ffmpeg)의 것을 쓴다."""
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


FF = _ffmpeg()


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


def make(src, dst, ref=None, ceil=None, kbps=None, mono48=False, peak_max=None):
    """src → dst. kbps 를 주면 그 비트레이트로, mono48 이면 모노 48kHz 로 낸다(육성 m4a 기준).
    peak_max(dBFS) 를 주면 인코딩한 결과의 꼭대기가 그 값을 넘을 때 리미터 한도를 낮춰 다시 만든다 —
    낮은 비트레이트로 인코딩하면 꼭대기가 1~2dB 튀어 0 을 넘을 수 있기 때문이다."""
    global CEIL
    if ceil is not None:
        CEIL = ceil
    i0, p0 = measure(src)
    gain = TARGET - i0
    ext = dst.lower().rsplit('.', 1)[-1]
    rate = kbps or min(info(ref or src)[1], 192)
    codec = ['-c:a', 'aac', '-movflags', '+faststart'] if ext == 'm4a' else ['-c:a', 'libmp3lame']  # m4a 는 재생 정보를 앞에 둔다
    if mono48:
        codec = ['-ac', '1', '-ar', '48000'] + codec
    for _attempt in range(6):
        for _ in range(6):
            i1, _p = measure(src, gain)
            if abs(i1 - TARGET) < 0.05:
                break
            gain += TARGET - i1
        # 인코딩을 거치면 잰 값이 조금 달라지므로, 결과를 다시 재서 0.1 안으로 들 때까지 고친다
        for _ in range(4):
            run(['-y', '-i', src, '-vn', '-af', chain(gain), '-b:a', '%dk' % rate] + codec + [dst])
            i2, p2 = measure(dst)
            if abs(i2 - TARGET) <= 0.1:
                break
            gain += TARGET - i2
        if peak_max is None or p2 <= peak_max:
            break
        CEIL -= (p2 - peak_max) + 0.2
    sec0, sec1 = info(ref or src)[0], info(dst)[0]
    if abs(sec1 - sec0) > 0.3:
        raise SystemExit('길이가 %.2f초 바뀌어 멈춥니다: %s' % (sec1 - sec0, dst))
    return {'전': (i0, p0), '키운 값(dB)': round(gain, 2), '후': (i2, p2), '한도': round(CEIL, 1), '길이': (sec0, sec1)}


def fix_inplace(path, tol=0.3, **kw):
    """path 를 제자리에서 -16 LUFS 로 맞춘다. 이미 ±tol 안이면 건드리지 않고 None 을 돌려준다."""
    before, _peak = measure(path)
    if abs(before - TARGET) <= tol:
        return None
    ext = path.lower().rsplit('.', 1)[-1]
    tmp = path + '.l16.' + ext
    try:
        result = make(path, tmp, peak_max=-1.0, **kw)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return result


def new_mp3s():
    """아직 커밋하지 않은 audio/*.mp3 (새로 만들었거나 바뀐 것)."""
    out = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=all', '--', 'audio'],
                         capture_output=True, text=True, errors='replace').stdout
    paths = []
    for line in out.splitlines():
        name = line[3:].strip().strip('"')
        if name.lower().endswith('.mp3') and os.path.exists(name):
            paths.append(name)
    return paths


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] in ('--fix', '--fix-new'):
        files = new_mp3s() if args[0] == '--fix-new' else args[1:]
        if not files:
            print('맞출 파일이 없습니다.')
        for f in files:
            try:
                r = fix_inplace(f)
                print('%s: %s' % (f, '이미 맞음' if r is None else '%.1f → %.1f LUFS' % (r['전'][0], r['후'][0])))
            except SystemExit as e:        # 길이가 바뀌는 등 — 원본을 그대로 두고 알린다
                print('::warning::%s 는 맞추지 못했습니다(%s)' % (f, e))
    else:
        print(make(args[0], args[1], args[2] if len(args) > 2 else None))
