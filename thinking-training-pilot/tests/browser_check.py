from pathlib import Path
import json, re, urllib.request, urllib.error
from playwright.sync_api import sync_playwright, expect

OUT=Path('/mnt/data/pilot_qa')
OUT.mkdir(exist_ok=True)
BASE='http://127.0.0.1:3100'
ROOT=Path(__file__).resolve().parents[1]
# This environment blocks browser navigation. Render local files via set_content.
# The storage adapter below is a test double, not real-device persistence verification.
def serve(payload):
    opts=payload.get('opts') or {}
    headers=opts.get('headers') or {}
    headers['Origin']=BASE
    req=urllib.request.Request(BASE+'/api/ai', data=opts.get('body','').encode() if opts.get('body') else None, headers=headers, method=opts.get('method','GET'))
    try:
        r=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as e:
        r=e
    return {'status':r.code,'text':r.read().decode()}

def mount(page,first=False):
    if first:
        page.expose_function('__localServer',serve)
        page.evaluate('''() => {
          const map=new Map();
          Object.defineProperty(window,'localStorage',{value:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear:()=>map.clear()},configurable:true});
          window.fetch=async (url,opts)=>{const r=await window.__localServer({url,opts});return new Response(r.text,{status:r.status,headers:{'content-type':'application/json'}});};
        }''')
    html=(ROOT/'public/index.html').read_text()
    html=re.sub(r'<script[^>]*src=[^>]*></script>','',html)
    html=re.sub(r'<link[^>]*stylesheet[^>]*>','',html)
    page.set_content(html)
    page.add_style_tag(content=(ROOT/'public/styles.css').read_text())
    page.add_script_tag(content=(ROOT/'public/data.js').read_text().replace('const PILOT =','window.PILOT ='))
    page.add_script_tag(content=(ROOT/'public/app.js').read_text())
KEY='ai-thinking-pilot-0.4-state'
CODE='local-test-access-code-only'
results=[]

def passed(name):
    results.append({'check':name,'passed':True})

def ready(page):
    page.wait_for_function("document.getElementById('connectionStatus').textContent.includes('サーバー設定済み')")

def unlock(page):
    page.locator('#consent').check()
    page.locator('#accessDetails').evaluate('(e)=>e.open=true')
    page.locator('#accessInput').fill(CODE)
    page.locator('#verifyAccess').click()
    expect(page.locator('#accessStatus')).to_contain_text('利用コードを確認しました')

def begin(page,course):
    page.locator('#startBtn').click()
    page.locator(f'[data-course="{course}"]').click()
    expect(page.locator('#scenarioText')).to_be_visible()
    expect(page.locator('#choices')).to_be_visible()
    page.locator('input[name=choice]').nth(1).check()
    page.locator('#saveChoice').click()
    page.locator('#screen-choiceFeedback [data-go=question]').click()
    page.locator('#q1').fill('条件が変わる場合も含めて、どの点を確認できますか？')
    page.locator('#saveQuestion').click()
    expect(page.locator('#screen-questionFeedback')).to_be_visible()
    page.locator('#screen-questionFeedback [data-go=dialogintro]').click()
    page.locator('#startChat').click()
    expect(page.locator('#screen-chat')).to_be_visible()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for course,n in [('work',3),('relation',3),('diet',6)]:
        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        mount(page,first=True);ready(page)
        expect(page.locator('u')).to_have_text('正解を考えすぎず、普段の自分ならどうするかという感覚で進めてください。')
        assert page.locator('.intro').evaluate('(e)=>getComputedStyle(e).fontWeight')=='700'
        if course=='work': page.screenshot(path=str(OUT/'01-start-mobile.png'),full_page=True)
        unlock(page);begin(page,course)
        assert len(page.locator('#chatBox .msg').all())==1
        expect(page.locator('#endChat')).to_be_hidden()
        for i in range(n):
            page.locator('#chatInput').fill(f'{i+1}回目です。条件を踏まえて今回はこの方針で考えています。')
            page.locator('#sendChat').click()
            expect(page.locator('#turns')).to_have_text(f'対話 {i+1} / 6往復')
            if i<2: expect(page.locator('#endChat')).to_be_hidden()
        if course=='diet':
            expect(page.locator('#chatEntry')).to_be_hidden()
            expect(page.locator('#turnLimitText')).to_be_visible()
            expect(page.locator('#screen-chat')).to_be_visible()
            passed('6往復後も最終AI回答を読んでから次へ進める')
        expect(page.locator('#endChat')).to_be_visible()
        if course=='work': page.screenshot(path=str(OUT/'02-chat-mobile.png'),full_page=True)
        page.locator('#endChat').click()
        page.locator('input[name=judgment]').nth(3).check()
        page.locator('#reason').fill('現時点では判断を保留するため。')
        page.locator('#saveJudgment').click()
        expect(page.locator('#screen-finalfeedback')).to_be_visible()
        assert len(page.locator('#finalSections h3').all())==4
        expect(page.locator('#feedbackClosing')).to_contain_text('一度立ち止まり')
        assert not page.locator('[id=rewrite]').count()
        stored=page.evaluate('(k)=>localStorage.getItem(k)',KEY)
        s=json.loads(stored)
        assert len(s['history'])==1+2*n
        assert len(s['callMeta'])==n+3
        assert CODE not in stored and 'not-a-real-api-key' not in stored
        assert s['history'][0]['role']=='assistant'
        assert len(s['feedback']['sections'])==4
        if course=='work': page.screenshot(path=str(OUT/'03-feedback-mobile.png'),full_page=True)
        page.locator('#screen-finalfeedback [data-go=closing]').click()
        page.locator('#finishBtn').click()
        mount(page);ready(page)
        page.locator('#continueBtn').click()
        expect(page.locator('#screen-finalfeedback')).to_be_visible()
        assert page.evaluate('(k)=>JSON.parse(localStorage.getItem(k)).history.length',KEY)==1+2*n
        passed(f'{course}: 選択→個別フィードバック→実対話→判断→最終表示→再表示復元（保存API代用品）')
        assert not errors,errors
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#pauseBtn').click()
        with page.expect_download() as download:
            page.locator('#exportBtn').click()
        path=download.value.path();content=Path(path).read_text()
        assert '固定解説後の自由質問' in content
        assert '実対話の開始設定／利用者が自作した発言ではない' in content
        assert '対話後のフィードバック' in content
        page.once('dialog',lambda d:d.accept())
        page.locator('#deleteBtn').click()
        assert page.evaluate('(k)=>localStorage.getItem(k)',KEY) is None
        passed(f'{course}: 端末ファイル保存・履歴削除・秘密情報を保存しない')
        context.close()

    # Failure preservation, resume, XSS and narrow/mobile layout.
    context=browser.new_context(viewport={'width':320,'height':740},is_mobile=True)
    page=context.new_page();mount(page,first=True);ready(page);unlock(page)
    page.locator('#startBtn').click();page.locator('[data-course=relation]').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'04-choice-320px.png'),full_page=True)
    page.locator('input[name=choice]').last.check()
    page.locator('#other').fill('いったん考えるのをやめるが、結論はまだ保留。')
    page.locator('#saveChoice').click();page.locator('[data-go=question]').click()
    q='<img src=x onerror="window.pilotXss=1"> FAIL_ONCE_TEST'
    page.locator('#q1').fill(q)
    page.locator('#saveQuestion').click()
    expect(page.locator('#errorBox')).to_be_visible()
    expect(page.locator('#q1')).to_have_value(q)
    state=json.loads(page.evaluate('(k)=>localStorage.getItem(k)',KEY))
    assert state['question']==q and state['questionFeedback'] is None
    assert page.evaluate('window.pilotXss') is None
    passed('外部通信失敗時：入力を保持し、仮返答で隠さず、勝手に次へ進まない')
    mount(page);ready(page);unlock(page);page.locator('#continueBtn').click()
    expect(page.locator('#q1')).to_have_value(q)
    page.locator('#saveQuestion').click()
    expect(page.locator('#questionView')).to_have_text(q)
    assert page.locator('#questionView img').count()==0
    passed('再表示後に未送信入力と画面を復元（保存API代用品）、入力HTMLを実行しない')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    context.close()

    context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();mount(page,first=True);ready(page)
    page.screenshot(path=str(OUT/'05-start-desktop.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.locator('#notice summary').is_visible()
    # All text inputs have real label associations, not only placeholders.
    missing=page.evaluate("""Array.from(document.querySelectorAll('textarea,input[type=password]')).filter(x=>!document.querySelector('label[for="'+x.id+'"]')).map(x=>x.id)""")
    assert not missing,missing
    page.keyboard.press('Tab')
    assert page.evaluate('document.activeElement.classList.contains("skip")')
    passed('320/390/1280幅の横はみ出しなし、入力ラベル、キーボード導線')
    browser.close()
OUT.joinpath('browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
