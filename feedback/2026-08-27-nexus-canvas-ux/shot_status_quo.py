# 现状视觉取证：空舞台（无 mock）+ mock 数据注入（Playwright 路由拦截，零仓库改动）
import json, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5199/"
OUT = "shots"

MOCK_STATE = {
    "nodes": True, "version": "0.5.31",
    "sessions": [
        {"id": "a1b2c3d4", "label": "侦查-01", "team": "alpha", "name": "scout-01", "joined": True, "live": True},
        {"id": "e5f6a7b8", "label": "分析-02", "team": "alpha", "name": "analyst-02", "joined": True, "live": True},
        {"id": "c9d0e1f2", "label": "审查-03", "team": "alpha", "name": "review-03", "joined": True, "live": False},
        {"id": "11223344", "label": "寻源-04", "team": "beta", "name": "source-04", "joined": True, "live": True},
        {"id": "55667788", "label": "测算-05", "team": "beta", "name": "cost-05", "joined": True, "live": True},
        {"id": "99aabbcc", "label": "采购-06", "team": "beta", "name": "buyer-06", "joined": True, "live": False},
        {"id": "ddeeff00", "label": "自由节点", "team": "gamma", "name": "lone-07", "joined": True, "live": True},
    ],
    "canvas": {"teams": [
        {"name": "选品先锋", "team": "alpha/canvas/xuanpin", "members": [
            {"id": "a1b2c3d4", "team": "alpha/a1b2c3d4", "joined": True, "live": True},
            {"id": "e5f6a7b8", "team": "alpha/e5f6a7b8", "joined": True, "live": True},
            {"id": "c9d0e1f2", "team": "alpha/c9d0e1f2", "joined": True, "live": False}]},
        {"name": "采购战队", "team": "beta/canvas/caigou", "members": [
            {"id": "11223344", "team": "beta/11223344", "joined": True, "live": True},
            {"id": "55667788", "team": "beta/55667788", "joined": True, "live": True},
            {"id": "99aabbcc", "team": "beta/99aabbcc", "joined": True, "live": False}]},
    ]},
    "peers": [{"url": "http://192.168.3.88:3080", "score": 42}],
}

def shot(pw, name, mock):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    if mock:
        page.route("**/__dsh_a2a/state",
                   lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_STATE)))
        page.route("**/__dsh_a2a/canvas-layout",
                   lambda r: r.fulfill(status=200, content_type="application/json", body='{"layout":null}'))
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/{name}.png")
    browser.close()
    print("saved", name)

with sync_playwright() as pw:
    shot(pw, "status-quo-empty", mock=False)
    shot(pw, "status-quo-mocked", mock=True)
