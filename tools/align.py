# -*- coding: utf-8 -*-
"""받아쓴 결과의 시간을 원고 문단에 맞춰 붙인다.

받아쓰기는 군데군데 틀린다("하나님"을 "하다님"으로 듣는 식). 그래서 낱말을 그대로
맞추지 않고, 두 글자 흐름을 통째로 비교해 서로 맞는 대목(닻)을 찾은 뒤
그 사이는 비례로 메운다. 틀린 낱말이 좀 있어도 앞뒤 닻이 잡아 준다.

결과: 문단마다 시작 시각(초). 뷰어는 재생 위치를 보고 그 문단을 짚어 준다.
"""
import io
import json
import re
from difflib import SequenceMatcher

# 비교할 때는 공백·문장부호를 뺀 글자만 본다
DROP = re.compile(r'[^가-힣0-9a-zA-Z]')


def norm(t):
    return DROP.sub('', t)


def para_lines(p):
    if isinstance(p, dict):
        if 'p' in p: return p['p']
        if 'h' in p: return [p['h']]
        return []
    return p if isinstance(p, list) else []


def align(entry, segs):
    # 1) 받아쓴 글자를 한 줄로 잇고, 글자마다 시각을 매긴다
    tt, ttime = '', []
    for s in segs:
        body = norm(s['t'])
        if not body:
            continue
        span = max(s['e'] - s['s'], 0.01)
        for i, ch in enumerate(body):
            tt += ch
            ttime.append(s['s'] + span * i / len(body))

    # 2) 원고도 한 줄로 잇되, 각 문단이 어디서 시작하는지 적어 둔다
    ot, starts = '', []
    for p in entry.get('paragraphs', []):
        starts.append(len(ot))
        ot += norm(' '.join(para_lines(p)))

    if not tt or not ot:
        return None

    # 3) 두 글자 흐름에서 서로 맞는 대목(닻)을 찾는다
    sm = SequenceMatcher(None, ot, tt, autojunk=False)
    anchors = [(i, j) for i, j, n in sm.get_matching_blocks() if n >= 4]
    if len(anchors) < 2:
        return None

    # 4) 문단 시작 글자에 해당하는 시각을 닻 사이 비례로 구한다
    def time_at(oi):
        prev = None
        for (i, j) in anchors:
            if i <= oi:
                prev = (i, j)
            else:
                if prev is None:
                    return ttime[min(j, len(ttime) - 1)]
                # 앞뒤 닻 사이를 비례로 나눈다
                span_o = i - prev[0]
                r = (oi - prev[0]) / span_o if span_o else 0
                jj = int(prev[1] + (j - prev[1]) * r)
                return ttime[min(max(jj, 0), len(ttime) - 1)]
        jj = prev[1] + (oi - prev[0])
        return ttime[min(max(jj, 0), len(ttime) - 1)]

    times = [round(time_at(s), 2) for s in starts]

    # 5) 시각은 반드시 앞에서 뒤로 흘러야 한다
    for i in range(1, len(times)):
        if times[i] < times[i - 1]:
            times[i] = times[i - 1]
    return times


if __name__ == '__main__':
    import sys
    entry_no = int(sys.argv[1])
    data = json.load(io.open(sys.argv[2], encoding='utf-8'))
    entry = [x for x in data if x.get('no') == entry_no][0]
    segs = json.load(io.open(sys.argv[3], encoding='utf-8'))
    print(align(entry, segs))
