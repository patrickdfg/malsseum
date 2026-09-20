# -*- coding: utf-8 -*-
"""새 말씀이 올라오면, 성령사연 설정에서 '받기'를 누른 기기로 알림을 보낸다.

쓰는 법 (저장소 루트에서):
    python tools/send_push.py          # 마지막 편을 아직 안 보냈으면 보낸다
    python tools/send_push.py --test   # 시험 알림 (보낸 기록을 남기지 않는다)

필요한 것:
    pip install pywebpush cryptography
    환경변수 SAYEON_PASS        원고 암호 (마지막 편을 읽는다)
             VAPID_PRIVATE_KEY  알림 서명 열쇠 (짝인 공개 열쇠는 settings.js)
             PUSH_TOKEN         Supabase 명단을 읽는 발송 토큰
    알림 비밀값이 없으면 아무것도 안 하고 끝난다 — 게시를 멈추지 않기 위해서.

**명단은 성령사연과 하나다.** 두 사이트가 같은 호스트(patrickdfg.github.io)라
브라우저가 보기엔 같은 출처이고, 알림 명단도 Supabase 표 하나를 같이 쓴다.
그래서 이 파일은 sayeon 의 `tools/send_push.py` 와 같은 함수를 부르고,
보내는 주소(`/malsseum/#n=`)와 '보냄' 기록 열쇠(`mal-`)만 다르다.
열쇠에 `mal-` 을 붙이는 것은 사연 편 번호와 섞이지 않게 하기 위함이다
(사연 35편과 말씀 35편이 같은 칸을 차지하면 둘 중 하나가 안 간다).

한 편은 한 번만 보낸다. 보내기 전에 Supabase 에 '이 편 보냄'을 먼저 적고,
이미 적혀 있으면 건너뛴다(같은 편을 고쳐서 다시 올려도 알림이 또 가지 않는다).
"""
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crypt  # noqa: E402

SITE = 'https://patrickdfg.github.io/malsseum/'
DATA = 'malsseum.json'
CLAIM_PREFIX = 'mal-'
ENDPOINT_OK = re.compile(
    r'^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
    r'[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/')


def supabase():
    """방문 통계가 쓰는 공개 주소와 공개 열쇠를 그대로 쓴다."""
    text = io.open(os.path.join(crypt.REPO, 'analytics-config.js'), encoding='utf-8').read()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', text).group(1).rstrip('/')
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', text).group(1)
    return url, key


def rpc(name, body):
    url, key = supabase()
    req = urllib.request.Request(
        url + '/rest/v1/rpc/' + name, data=json.dumps(body).encode('utf-8'),
        headers={'apikey': key, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')
        if 'forbidden' in detail:
            # 비밀값을 잘못 넣었을 때 어느 값이 들어갔는지 가릴 수 있게 지문(해시 앞 8자리)만 남긴다
            got = hashlib.sha256(body.get('p_token', '').encode('utf-8')).hexdigest()[:8]
            raise SystemExit('PUSH_TOKEN 이 Supabase 에 등록된 토큰과 다릅니다 (넣은 값 지문 %s)' % got)
        raise SystemExit('Supabase %s 실패 (%d): %s' % (name, e.code, detail[:200]))
    return json.loads(raw) if raw else None


def wait_for_pages(timeout=600):
    """알림을 눌렀는데 옛 목록이 보이면 안 되므로, 새 원고가 사이트에 올라갈 때까지 기다린다."""
    local = open(os.path.join(crypt.REPO, DATA + '.enc'), 'rb').read()
    end = time.time() + timeout
    while time.time() < end:
        try:
            u = SITE + DATA + '.enc?v=%d' % time.time()
            with urllib.request.urlopen(u, timeout=30) as r:
                if r.read() == local:
                    print('사이트에 새 원고가 올라간 것 확인')
                    return
        except Exception as e:  # 배포 중에는 잠깐 실패할 수 있다
            print('  사이트 확인 중: %s' % e)
        time.sleep(20)
    print('사이트 반영을 %d초 기다렸지만 확인 못 함 — 그래도 보낸다' % timeout)


def latest(data):
    """화면과 같은 차례(날짜 순)로 보고 맨 끝을 새 편으로 삼는다.

    말씀의 `no` 는 화면에 안 보이는 고유 번호일 뿐이라 큰 번호가 새 편이 아니다
    (1~7월 TTS 가 100~153, 8~9월 육성이 1~12·33~). 날짜(`short`)로 골라야 한다.
    """
    def key(item):
        month, day = item['short'].split('/')
        return (int(month), int(day))
    return max(data, key=key)


def main(args):
    from pywebpush import WebPushException, webpush

    vapid = os.environ.get('VAPID_PRIVATE_KEY', '').strip()
    token = os.environ.get('PUSH_TOKEN', '').strip()
    if not vapid or not token:
        print('알림 비밀값(VAPID_PRIVATE_KEY, PUSH_TOKEN)이 없어 알림은 건너뜀')
        return

    test = '--test' in args
    if test:
        no = 'test'
        payload = {'title': '알림 시험', 'body': '새 말씀 알림이 잘 옵니다.',
                   'url': '/malsseum/', 'tag': 'mal-test'}
    else:
        data = crypt.read_json(os.path.join(crypt.REPO, DATA))
        last = latest(data)
        no = str(last['no'])
        wait_for_pages()
        if not rpc('push_claim', {'p_token': token, 'p_item_no': CLAIM_PREFIX + no}):
            print('%s 알림은 이미 보냈음 — 건너뜀' % last['title'])
            return
        payload = {'title': '새 말씀', 'body': '%s 이(가) 올라왔습니다' % last['title'],
                   'url': '/malsseum/#n=' + urllib.parse.quote(no), 'tag': 'mal-' + no}

    subs = rpc('push_list', {'p_token': token}) or []
    sent = gone = failed = 0
    for s in subs:
        if not ENDPOINT_OK.match(s['endpoint']):
            continue
        try:
            webpush(subscription_info={'endpoint': s['endpoint'],
                                       'keys': {'p256dh': s['p256dh'], 'auth': s['auth']}},
                    data=json.dumps(payload, ensure_ascii=False),
                    vapid_private_key=vapid,
                    vapid_claims={'sub': 'https://patrickdfg.github.io'},
                    # 보통 알림은 화면이 꺼진 폰(절전)에서 몇 시간씩 미뤄지므로 급한 알림으로 보낸다
                    headers={'Urgency': 'high'},
                    ttl=24 * 3600)
            sent += 1
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):      # 알림을 끄거나 앱을 지운 기기
                rpc('push_drop', {'p_token': token, 'p_endpoint': s['endpoint']})
                gone += 1
            else:
                failed += 1
                print('  보내기 실패 (%s): %s' % (status, str(e)[:120]))
    print('말씀 %s 알림: 명단 %d대, 보냄 %d, 사라진 기기 정리 %d, 실패 %d'
          % (no, len(subs), sent, gone, failed))


if __name__ == '__main__':
    main(sys.argv[1:])
