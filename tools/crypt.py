# -*- coding: utf-8 -*-
"""원고와 사진을 암호로 잠그고 푸는 일을 맡는다.

저장소가 공개라, 예전에는 주소만 알면 암호창을 거치지 않고
sayeon.json 을 그대로 받아 볼 수 있었다. 이제 잠근 파일(.enc)만 올린다.
브라우저는 crypt.js 로 같은 방식으로 푼다.

잠그는 방식:
  열쇠 = PBKDF2-HMAC-SHA256(암호, 소금, 반복수) 32바이트
  파일 = 첫 12바이트가 iv, 나머지가 AES-GCM 으로 잠근 내용
  소금과 반복수는 crypt.json 에 적어 둔다(소금은 숨길 것이 아니다).

암호는 환경변수 SAYEON_PASS 로 준다. 깃허브에서는 저장소 비밀값으로 넣는다.
"""
import base64
import io
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(REPO, 'crypt.json')

_key = None


def passcode():
    p = os.environ.get('SAYEON_PASS')
    if not p:
        raise SystemExit(
            '암호를 찾지 못했습니다. 환경변수 SAYEON_PASS 에 넣어 주세요.\n'
            '  (깃허브에서는 저장소 Settings → Secrets → Actions 에 넣습니다)')
    return p


def meta():
    return json.load(io.open(META, encoding='utf-8'))


def key():
    """암호에서 열쇠를 만든다. 한 번만 만들어 두고 다시 쓴다(느린 셈이라)."""
    global _key
    if _key is None:
        m = meta()
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                         salt=base64.b64decode(m['salt']),
                         iterations=int(m['iter']))
        _key = kdf.derive(passcode().encode('utf-8'))
    return _key


def seal(data):
    """바이트를 잠근다."""
    iv = os.urandom(12)
    return iv + AESGCM(key()).encrypt(iv, data, None)


def open_(blob):
    """잠긴 바이트를 푼다. 암호가 다르면 예외가 난다."""
    return AESGCM(key()).decrypt(blob[:12], blob[12:], None)


def read_json(path):
    """잠긴 원고를 읽어 파이썬 값으로 돌려준다. (path 는 .enc 를 뺀 이름)"""
    blob = io.open(path + '.enc', 'rb').read()
    return json.loads(open_(blob).decode('utf-8'))


def write_json(path, value, indent=1):
    """파이썬 값을 원고 꼴로 만들어 잠가 저장한다."""
    text = json.dumps(value, ensure_ascii=False, indent=indent)
    io.open(path + '.enc', 'wb').write(seal(text.encode('utf-8')))
    return text


def read_text(path):
    """잠긴 글을 문자열로 읽는다."""
    return open_(io.open(path + '.enc', 'rb').read()).decode('utf-8')


def write_text(path, text):
    """문자열을 그대로 잠가 저장한다(줄 순서를 지켜야 할 때 쓴다)."""
    io.open(path + '.enc', 'wb').write(seal(text.encode('utf-8')))
