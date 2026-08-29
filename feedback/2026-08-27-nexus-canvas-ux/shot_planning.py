# 规划模式视觉取证：mock 数据（2 队 + 跨队成员 + 联邦对端），走真实构建产物。
# 与 shot_status_quo.py 同范式：Playwright 路由拦截，零仓库改动。
# 前置：nexus-stage 构建产物已在 assets/nexusDist（pnpm verify:nexus 会建）。
# 本地伺服：python nexus-stage/scripts/mockhost.py 5199   （或 vite dev）
import json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5199/"
OUT = "shots"

MOCK_STATE = {
    "nodes": True, "version": "0.5.32",
    "sessions": [
        {"id": "a1b2c3d4", "label": "侦查-01", "team": "alpha/a1b2c3d4", "name": "scout-01", "joined": True, "live": True},
        {"id": "e5f6a7b8", "label": "分析-02", "team": "alpha/e5f6a7b8", "name": "analyst-02", "joined": True, "live": True},
        {"id": "c9d0e1f2", "label": "审查-03", "team": "alpha/c9d0e1f2", "name": "review-03", "joined": True, "live": False},
        {"id": "11223344", "label": "寻源-04", "team": "beta/11223344", "name": "source-04", "joined": True, "live": True},
        {"id": "55667788", "label": "测算-05", "team": "beta/55667788", "name": "cost-05", "joined": True, "live": True},
        {"id": "99aabbcc", "label": "采购-06", "team": "beta/99aabbcc", "name": "buyer-06", "joined": True, "live": False},
        {"id": "ddeeff00", "label": "自由节点", "team": "gamma/ddeeff00", "name": "lone-07", "joined": True, "live": True},
    ],
    "canvas": {"teams": [
        {"name": "选品先锋", "team": "alpha/canvas/xuanpin", "members": [
            {"id": "a1b2c3d4", "team": "alpha/a1b2c3d4", "joined": True, "live": True},
            {"id": "e5f6a7b8", "team": "alpha/e5f6a7b8", "joined": True, "live": True},
            {"id": "c9d0e1f2", "team": "alpha/c9d0e1f2", "joined": True, "live": False}]},
        {"name": "采购战队", "team": "beta/canvas/caigou", "members": [
            {"id": "11223344", "team": "beta/11223344", "joined": True, "live": True},
            {"id": "55667788", "team": "beta/55667788", "joined": True, "live": True},
            {"id": "e5f6a7b8", "team": "alpha/e5f6a7b8", "joined": True, "live": True},
            {"id": "99aabbcc", "team": "beta/99aabbcc", "joined": True, "live": False}]},
    ]},
    "peers": [{"url": "http://192.168.3.88:3080", "score": 42}],
}

# 已保存布局：卡片摆开 + 队框矩形（走真实的 saved-wins 读路径）。
MOCK_LAYOUT = {"ok": True, "layout": {
    "version": 1, "viewport": {"x": 60, "y": 120, "scale": 1},
    "nodes": {
        "a1b2c3d4": {"x": 220, "y": 400}, "e5f6a7b8": {"x": 460, "y": 410},
        "c9d0e1f2": {"x": 300, "y": 540}, "11223344": {"x": 780, "y": 400},
        "55667788": {"x": 1000, "y": 420}, "99aabbcc": {"x": 860, "y": 560},
        "ddeeff00": {"x": 1320, "y": 470},
    },
    "frames": {
        "选品先锋": {"x": 110, "y": 300, "w": 470, "h": 330},
        "采购战队": {"x": 670, "y": 290, "w": 520, "h": 360},
    },
}}


def shot(pw, name, with_layout):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.route("**/__dsh_a2a/state",
               lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_STATE)))
    page.route("**/__dsh_a2a/canvas-layout",
               lambda r: r.fulfill(status=200, content_type="application/json",
                                   body=json.dumps(MOCK_LAYOUT if with_layout else {"ok": True, "layout": None})))
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.get_by_role("tab", name="规划").click()
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/{name}.png")
    browser.close()
    print("saved", name)


with sync_playwright() as pw:
    # 无布局：卡片落在卡尺度哈希环上（未整理态也能读）。
    shot(pw, "planning-mocked-fresh", with_layout=False)
    # 已保存布局：saved-wins + 队框 + 星形成员边（跨队虚线）。
    shot(pw, "planning-mocked-arranged", with_layout=True)
