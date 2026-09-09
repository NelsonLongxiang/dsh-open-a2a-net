import React from 'react'
import { createRoot } from 'react-dom/client'
import { OfficeFloor } from './scene/office/OfficeFloor'
import { startPolling } from './feed'
import './design/tokens.css'
import './design/global.css'

// dsh-a2a-munder-difflin: the A2A office floor. Same-origin plugin page;
// data arrives over the plugin REST faces via ./feed.

const brand = document.createElement('div')
brand.setAttribute('style', [
  'position:fixed', 'z-index:20', 'left:14px', 'top:12px',
  'font-size:13px', 'letter-spacing:.06em', 'color:#f4e9c7',
  'background:rgba(26,19,32,.82)', 'border:1px solid rgba(244,233,199,.25)',
  'border-radius:6px', 'padding:6px 10px', 'pointer-events:none',
].join(';'))
brand.textContent = 'dsh-a2a-munder-difflin · A2A Floor'
document.body.appendChild(brand)

const legend = document.createElement('div')
legend.setAttribute('style', [
  'position:fixed', 'z-index:20', 'right:14px', 'bottom:12px',
  'font-size:11px', 'line-height:1.7', 'color:#c9cede',
  'background:rgba(26,19,32,.72)', 'border-radius:6px', 'padding:8px 10px',
  'pointer-events:none',
].join(';'))
legend.innerHTML = [
  '<b>A2A 办公层</b> - 每个加入的会话是一位员工',
  '拖拽空白处平移 · 滚轮缩放 · 点击头像聚焦',
  '信封颜色：<span style=color:#34d399>外发</span> / <span style=color:#a78bfa>来件</span> / <span style=color:#f87171>失败</span>',
].join('<br>')
document.body.appendChild(legend)

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(React.createElement(OfficeFloor))
void startPolling()