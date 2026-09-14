#!/usr/bin/env python3
"""말씀 원고를 현수 TTS와 문단 동기화 파일로 만든다."""
import asyncio
import io
import json
import os
import sys

import edge_tts

import crypt


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "malsseum.json")
SYNC = os.path.join(ROOT, "audio", "sync.json")
VOICE = "ko-KR-HyunsuMultilingualNeural"


def lines_of(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        if "p" in value:
            return value["p"]
        if "h" in value:
            return [value["h"]]
    return []


def build_text(entry):
    parts = [entry["title"]] + list(entry.get("subtitle", []))
    starts = []
    for paragraph in entry.get("paragraphs", []):
        body = " ".join(lines_of(paragraph)).strip().replace("왜?", "왜냐하면,")
        starts.append(sum(len(part) + 2 for part in parts))
        if body:
            parts.append(body)
    return "\n\n".join(parts), starts


async def synthesize(text, out):
    boundaries = []
    cursor = 0
    with open(out, "wb") as audio:
        stream = edge_tts.Communicate(text, VOICE, boundary="SentenceBoundary")
        async for chunk in stream.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "SentenceBoundary":
                body = chunk.get("text", "")
                pos = text.find(body, cursor)
                if pos < 0:
                    pos = cursor
                boundaries.append((pos, chunk["offset"] / 10_000_000))
                cursor = pos + len(body)
    return boundaries


def paragraph_times(starts, boundaries):
    if not boundaries:
        raise RuntimeError("TTS 문장 시간 정보를 받지 못했습니다.")
    result = []
    for start in starts:
        following = [when for pos, when in boundaries if pos >= start]
        result.append(round(following[0] if following else boundaries[-1][1], 2))
    return result


async def main(args):
    data = crypt.read_json(DATA)
    targets = {int(value) for value in args}
    sync = json.load(io.open(SYNC, encoding="utf-8"))
    def save():
        crypt.write_json(DATA, data, indent=1)
        io.open(SYNC, "w", encoding="utf-8", newline="").write(
            json.dumps(sync, ensure_ascii=False, separators=(",", ":")))

    # '--all' 은 아직 음성이 없는 편 전부를 뜻한다
    todo = [e for e in data
            if (not targets and not e.get("audio")) or e["no"] in targets]
    print("만들 편: %d 개" % len(todo))
    for entry in todo:
        # 파일명은 MMDD 로 맞춘다 (8/2 -> 0802, 1/4 -> 0104).
        # 예전 코드는 "1/4"->"14"->"0014" 로 월·일을 붙여 버려 어긋났다.
        month, day = (int(x) for x in entry["short"].split("/"))
        rel = "audio/%02d%02d.mp3" % (month, day)
        out = os.path.join(ROOT, rel)
        # 이미 만들어 둔 편은 건너뛴다 (중간에 멈춰도 다시 돌리면 이어서 한다)
        if entry.get("audio") == rel and os.path.exists(out) \
                and str(entry["no"]) in sync:
            print("  %s 편: 이미 있음" % entry["no"])
            continue
        text, starts = build_text(entry)
        boundaries = await synthesize(text, out)
        sync[str(entry["no"])] = paragraph_times(starts, boundaries)
        entry["audio"] = rel
        entry["tts"] = True
        print("  %s %s %s" % (entry["no"], entry["title"], os.path.getsize(out)))
        save()          # 한 편 끝날 때마다 저장 — 도중에 멈춰도 만든 편은 남는다


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit("사용법: python make_malsseum_tts.py 13 14 ...  또는  --all")
    asyncio.run(main([] if args == ["--all"] else args))
