# 2025년 이전 말씀 HWP 폴더에서 날짜마다 한 판을 골라 malsseum_old.json(.enc)을 만든다 — 음성 없이 글만
"""사용: SAYEON_PASS=암호 python tools/import_old_malsseum.py <HWP폴더> [--write]

- 날짜(머리글 <YYYY년 M월 D일 …>)마다 한 판만 고른다.
  설교자 낭독용 판(쉼 표시 '/' 가 20개 넘는 판)은 깨끗한 판이 있으면 뺀다.
  그다음 파일 이름에 최종·완성이 있는 판, 그다음 글이 가장 긴 판을 고른다.
  낭독용 판밖에 없으면 '/' 표시를 지우고 'J 이/은/께…' 를 '예수님…' 으로 바꾼다.
- 새벽잠언·수련회·본문만 있는 파일·추가 자료·900자 미만 조각·하위 폴더(8강 등)는 뺀다.
- 편 번호(no)는 1000부터 날짜순. year 칸이 있어 뷰어 연도 탭이 이것으로 나눈다.
- --write 없이 돌리면 old.json(평문, 저장소에 올리지 말 것)과 report.txt 만 만든다.
"""
import json
import os
import re
import struct
import sys
import zlib

import olefile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_malsseum_hwp import decode_para_text  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'src'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BULLET = tuple('•‣*※◈○◎■□▶◆●-')
SKIP_HEAD = re.compile(r'새벽|수련회|본문>|참고 잠언|추가')
FINAL = re.compile(r'최종|완성')


def raw_paras(path):
    """HWP 문단을 순서대로 읽는다. 빈 문단은 '' 로 남긴다(문단 경계)."""
    ole = olefile.OleFileIO(path)
    h = ole.openstream('FileHeader').read()
    comp = bool(struct.unpack_from('<I', h, 36)[0] & 1)
    secs = sorted((e for e in ole.listdir() if '/'.join(e).startswith('BodyText/Section')),
                  key=lambda e: int(re.search(r'(\d+)$', e[-1]).group(1)))
    out, pending = [], False
    for e in secs:
        b = ole.openstream(e).read()
        if comp:
            b = zlib.decompress(b, -15)
        p = 0
        while p + 4 <= len(b):
            v = struct.unpack_from('<I', b, p)[0]
            p += 4
            tag, size = v & 0x3ff, (v >> 20) & 0xfff
            if size == 0xfff:
                size = struct.unpack_from('<I', b, p)[0]
                p += 4
            rec = b[p:p + size]
            p += size
            if tag == 66:            # 문단 머리 — 글이 안 따라오면 빈 문단
                if pending:
                    out.append('')
                pending = True
            elif tag == 67 and pending:
                out.append(decode_para_text(rec))
                pending = False
    return out


def lines_of(paras):
    """문단 흐름을 줄 목록으로 편다. 빈 줄 '' 은 경계로 남긴다."""
    out = []
    for t in paras:
        if not t.strip():
            out.append('')
            continue
        for ln in re.split(r'[\r\n]+', t):
            ln = ln.strip()
            if ln:
                out.append(ln)
    return out


def clean_line(ln, marked):
    if marked:
        ln = re.sub(r'\s*/{1,2}(?=\s|$)', '', ln)        # 설교자 쉼 표시 /, //
        ln = re.sub(r'(?<![A-Za-z])J\s?(?=[이은을의께])', '예수님', ln)
        ln = re.sub(r'\s{2,}', ' ', ln).strip()
    return ln


def head_info(lines, fname):
    for ln in lines[:6]:
        m = re.search(r'<\s*(20\d\d)년\s*(\d+)월\s*(\d+)일\s*([^>]*)>', ln)
        if m:
            return int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4).strip(), ln
    m = re.match(r'(\d\d)(\d\d)(\d\d)', fname)
    if m:
        return 2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)), '', None
    return None


def service_name(svc, y, mo, d):
    import datetime
    if '성탄' in svc:
        return '성탄말씀'
    if '금요' in svc:
        return '금요말씀'
    if '수요' in svc:
        return '수요말씀'
    if '주일' in svc or '잠언' in svc:
        return '주일말씀'
    wd = datetime.date(y, mo, d).weekday()
    return {2: '수요말씀', 6: '주일말씀', 4: '금요말씀'}.get(wd, '말씀')


def convert(path):
    fname = os.path.basename(path)
    lines = lines_of(raw_paras(path))
    info = head_info(lines, fname)
    y, mo, d, svc, headline = info
    text = '\n'.join(lines)
    marked = len(re.findall(r'/\s', text)) > 20
    if headline:
        lines = lines[lines.index(headline) + 1:]
    lines = [clean_line(l, marked) if l else '' for l in lines]
    # 머리글 바로 뒤의 제목 줄들(대괄호·본문 표시·글머리 전까지) = 부제
    while lines and not lines[0]:
        lines.pop(0)
    subtitle = []
    while lines and lines[0] and not lines[0].startswith(('[', '본 문', '본문', '<')) \
            and not lines[0].startswith(BULLET) and len(subtitle) < 3 and len(lines[0]) < 40:
        subtitle.append(lines.pop(0).rstrip('.'))
    while lines and not lines[0]:
        lines.pop(0)
    # 문단으로 묶기: 빈 줄과 글머리표에서 끊는다
    paras, cur = [], []
    for ln in lines:
        if not ln or (ln.startswith(BULLET) and cur):
            if cur:
                paras.append(cur)
            cur = [ln] if ln else []
        else:
            cur.append(ln)
    if cur:
        paras.append(cur)
    # 성경 본문: 처음 문단이 [..]·본 문 으로 시작하면 글머리 문단 전까지 묶는다
    out = []
    if paras and re.match(r'(\[|본\s*문)', paras[0][0]):
        scripture = []
        while paras and not paras[0][0].startswith(BULLET):
            scripture.extend(paras.pop(0))
            if len(scripture) > 60:
                break
        out = [{'h': '본문'}, scripture, {'hr': True}]
    out.extend(paras)
    name = service_name(svc, y, mo, d)
    return {
        'title': f'{mo}월 {d}일 {name}',
        'short': f'{mo}/{d}',
        'year': y,
        'subtitle': subtitle,
        'paragraphs': out,
        '_src': fname,
        '_marked': marked,
        '_len': len(text),
        '_final': bool(FINAL.search(fname)),
    }


def norm(t):
    return re.sub(r'[\s.,·…\-]', '', t)


def fix_subtitle(entry, names):
    """부제가 비었거나 엉뚱하면 파일 이름 괄호 속 제목을 쓴다."""
    title = None
    for n in names:
        for m in re.finditer(r'\(([^()]{3,})\)', n):
            t = m.group(1).strip()
            if not re.fullmatch(r'\d+|주일|수요|최종본?|완성본', t):
                title = title or t
    if not title:
        return
    sub = entry['subtitle']
    if norm(title) in norm(''.join(sub)) or norm(''.join(sub)) in norm(title) and sub:
        return
    if sub:
        at = 3 if entry['paragraphs'] and isinstance(entry['paragraphs'][0], dict) else 0
        entry['paragraphs'][at:at] = [sub] if at == 0 else []
        if at:
            entry['paragraphs'].insert(3, sub)
    entry['subtitle'] = [title.rstrip('.')]


def main():
    groups = {}
    skipped = []
    for root, dirs, files in os.walk(SRC):
        if root != SRC:
            skipped += [os.path.join(root, f) for f in files]
            continue
        for f in sorted(files):
            if not f.endswith('.hwp'):
                skipped.append(f)
                continue
            try:
                lines = lines_of(raw_paras(os.path.join(SRC, f)))
            except Exception as e:
                skipped.append(f + ' (읽기 실패: %s)' % e)
                continue
            info = head_info(lines, f)
            text = '\n'.join(lines)
            if not info or (info[4] and SKIP_HEAD.search(info[4])) or len(text) < 900 \
                    or info[0] < 2020:
                skipped.append(f)
                continue
            if not info[4] and not re.search(r'주일|수요|주\(|수\(', f) and f[:6] != '221005':
                skipped.append(f)
                continue
            key = (info[0], info[1], info[2])
            groups.setdefault(key, []).append(f)
    chosen, report = [], []
    for key in sorted(groups):
        cands = [convert(os.path.join(SRC, f)) for f in groups[key]]
        clean = [c for c in cands if not c['_marked']] or cands
        best = sorted(clean, key=lambda c: (c['_final'], c['_len']), reverse=True)[0]
        fix_subtitle(best, groups[key])
        chosen.append(best)
        report.append((key, best['_src'], [c['_src'] for c in cands if c is not best]))
    no = 1000
    for c in chosen:
        c['no'] = no
        no += 1
    for c in chosen:
        for k in [k for k in c if k.startswith('_')]:
            del c[k]
    if '--write' in sys.argv:
        import crypt as content_crypt
        content_crypt.write_json(os.path.join(ROOT, 'malsseum_old.json'), chosen, indent=1)
    else:
        json.dump(chosen, open('old.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open('report.txt', 'w', encoding='utf-8') as w:
        for key, b, rest in report:
            w.write('%d-%02d-%02d  고름: %s\n' % (key + (b,)))
            for r in rest:
                w.write('            제외: %s\n' % r)
        w.write('\n[아예 뺀 파일]\n' + '\n'.join(skipped) + '\n')
    print(len(chosen), 'chosen;', len(skipped), 'skipped')


if __name__ == '__main__':
    main()
