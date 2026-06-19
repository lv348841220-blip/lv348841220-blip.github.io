/**
 * Agent Chat Widget — 吕连生/Mark 作品集 AI 助手
 * 前端直调 MiMo API（SSE 流式），无需后端服务器
 */
(function () {
  'use strict';

  // ===== MiMo 直连配置 =====
  const MIMO_API = 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions';
  const MIMO_KEY = 'tp-somefi2z05cefnygpgwk3tt8yb1u8g9dcot1dr29okq4yalj';
  const MIMO_MODEL = 'mimo-v2.5-pro';

  // ===== 系统提示词 =====
  const SYSTEM_PROMPT = `你叫小马助手，是吕连生（Mark）个人作品集网站的 AI 助手。

关于吕连生：
- 35岁，住在深圳坪山
- 职业：短视频内容运营，base 深圳盈家实业（贝壳乐远），2025年3月入行
- 摄影摄像13年经验，Premiere / Final Cut / 剪映全熟
- 转型短视频运营后，从IP定位、选题策划、脚本撰写、拍摄剪辑到数据复盘全链路操盘
- 孵化IP：「深圳探房刘涛」从0做到2万+粉丝，单条572万播放；「老吴在坪山」走本地生活+房产路线
- YouTube频道「寰宇笋盘 GC Global」5.18万订阅
- 自建AI辅助工作流，用AI做选题拆解和脚本初稿
- 求职方向：短视频内容运营 / IP孵化

风格：口语化、直接、简洁（100-200字），带emoji。不知道就直说，别瞎编。
如果有人问到需要详细资料的问题，告诉对方可以去吕连生的IMA知识库搜索相关内容。
如果有人问薪资待遇，绝不说具体数字，引导对方加微信或约面谈详细聊。全程中文。`;

  let isOpen = false;
  let isSending = false;
  let abortCtrl = null;

  // ===== DOM Elements =====
  const bubble = createBubble();
  const panel = createPanel();
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('.agent-messages');
  const textarea = panel.querySelector('.agent-input-wrap textarea');
  const sendBtn = panel.querySelector('.agent-send');
  const closeBtn = panel.querySelector('.agent-close');
  const suggestionsEl = panel.querySelector('.agent-suggestions');

  // ===== Send message (SSE streaming direct to MiMo) =====
  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text || isSending) return;

    isSending = true;
    abortCtrl = new AbortController();
    sendBtn.disabled = true;
    textarea.disabled = true;

    appendUserMessage(text);
    textarea.value = '';
    textarea.style.height = 'auto';

    const welcome = messagesEl.querySelector('.agent-welcome');
    if (welcome) welcome.remove();
    if (suggestionsEl) suggestionsEl.style.display = 'none';

    const assistantEl = appendAssistantBubble();

    // 构建消息历史
    const historyEls = messagesEl.querySelectorAll('.agent-msg');
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const el of historyEls) {
      const role = el.classList.contains('user') ? 'user' : 'assistant';
      const content = el.querySelector('.msg-bubble')?.textContent || '';
      if (content && (role === 'user' || role === 'assistant')) {
        messages.push({ role, content });
      }
    }
    // 删掉刚才加的空 assistant 占位（它不在历史里，不用管）
    // 但最后一条 user message 已经在 messages 里了，所以没问题

    try {
      const res = await fetch(MIMO_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + MIMO_KEY,
        },
        body: JSON.stringify({
          model: MIMO_MODEL,
          messages: messages,
          max_tokens: 2048,
          stream: true,
        }),
        signal: abortCtrl.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '未知错误');
        appendErrorMessage('服务出错（' + res.status + '）：' + errText.slice(0, 100));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6); // 去掉 "data: "
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta;
            // 只取真正的回复内容，忽略 reasoning_content（思考过程）
            const content = delta?.content || '';
            if (content) {
              fullText += content;
              updateAssistantBubble(assistantEl, fullText);
            }
          } catch {
            // 跳过解析失败的 chunk
          }
        }
      }

      // 处理残余 buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
              fullText += content;
              updateAssistantBubble(assistantEl, fullText);
            }
          } catch {}
        }
      }

    } catch (err) {
      if (err.name !== 'AbortError') {
        appendErrorMessage('发送失败：' + err.message);
      }
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  }

  // ===== DOM helpers =====
  function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'agent-msg user';
    div.innerHTML = `
      <div class="msg-avatar">你</div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    messagesEl.appendChild(div);
    scrollBottom();
  }

  function appendAssistantBubble() {
    const div = document.createElement('div');
    div.className = 'agent-msg assistant';
    div.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-bubble"></div>
    `;
    messagesEl.appendChild(div);
    scrollBottom();
    return div;
  }

  function updateAssistantBubble(el, text) {
    const bubble = el.querySelector('.msg-bubble');
    if (bubble) {
      bubble.textContent = text;
      scrollBottom();
    }
  }

  function appendErrorMessage(text) {
    const div = document.createElement('div');
    div.className = 'agent-msg assistant';
    div.innerHTML = `
      <div class="msg-avatar">!</div>
      <div class="msg-bubble" style="color:#e24b4a;">${escapeHtml(text)}</div>
    `;
    messagesEl.appendChild(div);
    scrollBottom();
  }

  function scrollBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Toggle panel =====
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) textarea.focus();
  }

  // ===== Create Bubble Button =====
  function createBubble() {
    const el = document.createElement('div');
    el.className = 'agent-bubble';
    el.title = 'AI 助手';
    el.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.02 2 10.98c0 2.34 1.05 4.48 2.76 6.04-.24 1.2-.84 2.48-1.76 3.98 1.92-.24 3.48-.92 4.64-1.72A9.64 9.64 0 0012 20c5.52 0 10-4.03 10-9.01C22 6.02 17.52 2 12 2z"/>
      </svg>
      <div class="dot"></div>
    `;
    el.addEventListener('click', togglePanel);
    return el;
  }

  // ===== Create Chat Panel =====
  function createPanel() {
    const el = document.createElement('div');
    el.className = 'agent-panel';

    el.innerHTML = `
      <div class="agent-header">
        <div class="agent-title">
          <div class="agent-avatar">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <span class="agent-name">小马助手</span>
        </div>
        <span class="agent-status online">ONLINE</span>
        <button class="agent-close">&times;</button>
      </div>

      <div class="agent-messages">
        <div class="agent-welcome">
          <div class="welcome-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>
          </div>
          <div class="welcome-title">你好，我是小马助手</div>
          <div class="welcome-text">
            我是吕连生的 AI 助手。<br>
            想了解他的作品、能力或合作方式？<br>
            直接问我吧。
          </div>
        </div>
      </div>

      <div class="agent-suggestions">
        <button data-q="吕连生是谁？他是做什么的？">他是谁</button>
        <button data-q="展示一下他的代表作品">代表作品</button>
        <button data-q="他擅长拍什么类型的视频？">擅长什么</button>
        <button data-q="怎么联系他合作？">商务合作</button>
      </div>

      <div class="agent-input-wrap">
        <textarea placeholder="输入你的问题..." rows="1"></textarea>
        <button class="agent-send">
          <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
        </button>
      </div>
    `;

    const _textarea = el.querySelector('textarea');
    const _sendBtn = el.querySelector('.agent-send');
    const _closeBtn = el.querySelector('.agent-close');

    _closeBtn.addEventListener('click', togglePanel);
    _sendBtn.addEventListener('click', sendMessage);

    _textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    _textarea.addEventListener('input', () => {
      _textarea.style.height = 'auto';
      _textarea.style.height = Math.min(_textarea.scrollHeight, 120) + 'px';
    });

    el.querySelectorAll('.agent-suggestions button').forEach((btn) => {
      btn.addEventListener('click', () => {
        _textarea.value = btn.dataset.q;
        sendMessage();
      });
    });

    return el;
  }
})();
