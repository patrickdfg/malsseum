#!/usr/bin/env python3
"""HWP 말씀 원고를 malsseum.json 항목으로 변환한다."""
import argparse
import io
import json
import os
import re
import struct
import zlib

import olefile

try:
    import crypt as content_crypt
except ImportError:
    content_crypt = None


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "malsseum.json")


def extract_hwp_paragraphs(path):
    ole = olefile.OleFileIO(path)
    header = ole.openstream("FileHeader").read()
    compressed = bool(struct.unpack_from("<I", header, 36)[0] & 1)
    records = []
    sections = sorted(
        (entry for entry in ole.listdir()
         if "/".join(entry).startswith("BodyText/Section")),
        key=lambda entry: int(re.search(r"(\d+)$", entry[-1]).group(1)))
    for entry in sections:
        body = ole.openstream(entry).read()
        if compressed:
            body = zlib.decompress(body, -15)
        pos = 0
        while pos + 4 <= len(body):
            value = struct.unpack_from("<I", body, pos)[0]
            pos += 4
            tag = value & 0x3ff
            size = (value >> 20) & 0xfff
            if size == 0xfff:
                size = struct.unpack_from("<I", body, pos)[0]
                pos += 4
            record = body[pos:pos + size]
            pos += size
            if tag != 67:
                continue
            text = decode_para_text(record)
            lines = [re.sub(r"[ \t]+$", "", line)
                     for line in re.split(r"[\r\n]+", text)]
            lines = [line for line in lines if line.strip()]
            if lines:
                records.append(lines)
    return records


# HWPTAG_PARA_TEXT 의 글자 흐름에는 제어문자가 섞여 있다.
# - 줄/문단 나눔(0,10,13)은 한 글자
# - 인라인·확장 제어(아래 CTRL_WIDE)는 제어글자 + 데이터 7글자 = 8글자짜리
# 예전에는 제어글자 하나만 지우고 데이터 7글자를 남겨서
# '내가 줄 ⩤┥1)⩤%상이' 처럼 글 사이에 깨진 조각이 끼었다.
CTRL_WIDE = frozenset({1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12,
                       14, 15, 16, 17, 18, 19, 20, 21, 22, 23})


def decode_para_text(record):
    """제어문자를 규칙대로 건너뛰며 UTF-16LE 글자 흐름을 읽는다."""
    codes = struct.unpack("<%dH" % (len(record) // 2), record[: len(record) // 2 * 2])
    out = []
    i = 0
    n = len(codes)
    while i < n:
        c = codes[i]
        if c in CTRL_WIDE:
            i += 8            # 제어글자 + 데이터 7글자를 통째로 건너뛴다
            continue
        if c == 10 or c == 13:
            out.append("\n")
        elif c == 0 or c == 24 or c == 25:
            pass              # 채움/자리표시 글자는 버린다
        else:
            out.append(chr(c))
        i += 1
    return "".join(out)


def clean_records(records):
    date_index = next(i for i, record in enumerate(records)
                      if any(re.search(r"<2026년\s+\d+월\s+\d+일", line)
                             for line in record))
    records = records[date_index + 1:]
    # 문서 머리글의 날짜와 파일명 메타데이터는 화면 본문에서 제외한다.
    return [record for record in records
            if not any(re.search(r"\.hwp", line, re.I) for line in record)]


def make_entry(path, number, audio=None):
    extracted = extract_hwp_paragraphs(path)
    raw = [[line.strip() for line in record if line.strip()]
           for record in clean_records(extracted)]
    date_text = " ".join(line for record in extracted
                         for line in record)
    match = re.search(r"<2026년\s+(\d+)월\s+(\d+)일\s+([^>]+)>", date_text)
    if not match:
        raise ValueError("날짜 머리글을 찾지 못했습니다: " + path)
    month, day, service = int(match.group(1)), int(match.group(2)), match.group(3).strip()
    service = service.replace("알파날 연합예배 말씀", "알파날 연합예배")

    body_at = next((i for i, record in enumerate(raw)
                    if any(re.search(r"본\s*문\s*:", line) for line in record)), None)
    if body_at is None:
        raise ValueError("본문 표시를 찾지 못했습니다: " + path)
    subtitle = [line.rstrip(".") for record in raw[:body_at] for line in record]
    paragraphs = [{"h": "본문"}]
    first_record = [re.sub(r"^.*?본\s*문\s*:\s*", "", line).strip()
                    for line in raw[body_at]]
    first_record = [line for line in first_record if line]
    tail = ([first_record] if first_record else []) + raw[body_at + 1:]
    scripture = []
    while tail and tail[0] and tail[0][0].lstrip().startswith("<"):
        scripture.extend(tail.pop(0))
    if scripture:
        paragraphs.append(scripture)
    paragraphs.append({"hr": True})
    paragraphs.extend([record for record in tail if record])

    title = f"{month}월 {day}일 {service}"
    entry = {
        "no": number,
        "title": title,
        "short": f"{month}/{day}",
        "subtitle": subtitle,
        "paragraphs": paragraphs,
    }
    if audio:
        entry["audio"] = audio
    return entry, (month, day)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("hwp")
    parser.add_argument("--no", type=int, required=True)
    parser.add_argument("--audio")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    entry, _ = make_entry(args.hwp, args.no, args.audio)
    if not args.write:
        print(json.dumps(entry, ensure_ascii=False, indent=2))
        return
    encrypted = os.path.exists(DATA_PATH + ".enc")
    data = (content_crypt.read_json(DATA_PATH) if encrypted
            else json.load(io.open(DATA_PATH, encoding="utf-8")))
    if any(item["no"] == args.no for item in data):
        if not args.replace:
            raise SystemExit(f"식별번호 {args.no}가 이미 있습니다.")
        data = [item for item in data if item["no"] != args.no]
    data.append(entry)
    data.sort(key=lambda item: tuple(map(int, item["short"].split("/"))))
    if encrypted:
        content_crypt.write_json(DATA_PATH, data, indent=1)
    else:
        io.open(DATA_PATH, "w", encoding="utf-8", newline="").write(
            json.dumps(data, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
