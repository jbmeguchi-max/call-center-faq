/**
 * chat.js - チャットUI・業務カード表示・タブ切り替え・コピー機能
 */
window.Chat = (() => {
    const md = text => {
        if (!text) return '';
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^#{1,3}\s(.+)$/gm, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    };

    function appendUserMessage(query) {
        const box = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = 'msg msg-user';
        div.innerHTML = `<div class="msg-bubble">${escapeHtml(query)}</div>`;
        box.appendChild(div);
        scrollBottom();
    }

    function appendThinking() {
        const box = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = 'msg msg-bot thinking';
        div.id = 'thinking-indicator';
        div.innerHTML = `<div class="msg-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
        box.appendChild(div);
        scrollBottom();
    }

    function removeThinking() {
        const el = document.getElementById('thinking-indicator');
        if (el) el.remove();
    }

    /**
     * 通常の回答メッセージを追加
     */
    function appendBotMessage({ hits, workflowResult, policyResult, query }) {
        removeThinking();
        const box = document.getElementById('chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg msg-bot';

        let html = '';

        // ======= 回答不可（分からない）=======
        if (!policyResult.canAnswer || policyResult.canAnswer === 'partial') {
            html = buildUnknownCard(policyResult, workflowResult);
        }
        // ======= 回答可能 =======
        else {
            // 業務カード表示
            if (workflowResult && workflowResult.candidates && workflowResult.candidates.length > 0) {
                html = buildWorkflowCards(hits, workflowResult);
            } else {
                // 業務判定なし → シンプル回答
                html = buildSimpleAnswer(hits[0]);
            }
        }

        msgDiv.innerHTML = html;
        box.appendChild(msgDiv);

        // フィードバックボタン追加
        const fbDiv = document.createElement('div');
        fbDiv.className = 'feedback-row';
        fbDiv.innerHTML = buildFeedbackButtons();
        box.appendChild(fbDiv);

        scrollBottom();
        bindTabSwitchers(msgDiv);
        bindCopyButtons(msgDiv);
        return msgDiv;
    }

    function buildWorkflowCards(hits, workflowResult) {
        const { candidates } = workflowResult;
        const workflowIds = candidates.map(c => c.workflow.workflow_id);

        let header = '';
        if (candidates.length >= 2) {
            const names = candidates.map(c => c.workflow.workflow_name).join(' / ');
            header = `<div class="wf-header">📋 今回該当する業務: <strong>${names}</strong>（${candidates.length}件）</div>`;
        }

        const cards = candidates.map(cand => {
            const wf = cand.workflow;
            let wfHits = hits.filter(h =>
                (h.record.workflow_ids || []).includes(wf.workflow_id)
            );
            // workflow_id一致が0件 → 全ヒットを表示（common_flow等のFAQ対応）
            if (wfHits.length === 0) wfHits = hits;
            return buildSingleWorkflowCard(wf, wfHits);
        }).join('');

        return header + `<div class="wf-cards">${cards}</div>`;
    }

    function buildSingleWorkflowCard(wf, hits) {
        // step_phaseでグループ化
        const phaseMap = {
            overview: [], conditions: [], steps: [], scripts: [], exceptions: [], notes: []
        };
        hits.forEach(h => {
            const phase = h.record.step_phase || 'overview';
            if (phaseMap[phase]) phaseMap[phase].push(h);
            else phaseMap.notes.push(h);
        });

        const riskBadge = wf.risk_level === 'High'
            ? '<span class="badge badge-high">High</span>'
            : wf.risk_level === 'Med'
                ? '<span class="badge badge-med">Med</span>'
                : '<span class="badge badge-low">Low</span>';

        const slotsHtml = wf.required_slots && wf.required_slots.length > 0
            ? `<div class="card-section"><div class="section-label">▶ まず確認すること</div>
          <ul>${wf.required_slots.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`
            : '';

        const renderHits = (hitsArr, icon) => hitsArr.map(h => `
      <div class="answer-block">
        ${md(h.record.answer)}
        <div class="evidence-chip" data-record-id="${h.record.id}">
          📄 ${escapeHtml(h.record.source_file)} ${h.record.source_page ? escapeHtml(h.record.source_page) : ''} v${h.record.version} (${h.record.valid_from}版)
        </div>
      </div>
    `).join('');

        const condHtml = phaseMap.conditions.length
            ? `<div class="card-section"><div class="section-label">▶ 適用条件</div>${renderHits(phaseMap.conditions)}</div>` : '';
        const stepsHtml = phaseMap.steps.length
            ? `<div class="card-section"><div class="section-label">▶ 手順</div>${renderHits(phaseMap.steps)}</div>` : '';
        const excHtml = phaseMap.exceptions.length
            ? `<div class="card-section"><div class="section-label">▶ よくある例外</div>${renderHits(phaseMap.exceptions)}</div>` : '';
        const ovHtml = phaseMap.overview.length
            ? `<div class="card-section">${renderHits(phaseMap.overview)}</div>` : '';

        // トーク例（スクリプト）
        const scriptHit = phaseMap.scripts[0];
        const scriptHtml = scriptHit
            ? buildReadAloudTabs(scriptHit.record.answer, scriptHit.record.answer)
            : hits.length > 0
                ? buildReadAloudTabs(generateReadAloud(hits[0].record), hits[0].record.answer)
                : '';

        return `
      <div class="wf-card">
        <div class="wf-card-title">${riskBadge} ${escapeHtml(wf.workflow_name)}</div>
        ${slotsHtml}
        ${ovHtml}${condHtml}${stepsHtml}${excHtml}
        ${scriptHtml}
      </div>
    `;
    }

    function buildReadAloudTabs(readAloud, internalNote) {
        return `
      <div class="talk-tabs">
        <div class="tab-header">
          <button class="tab-btn active" data-tab="readout">📢 読み上げ用</button>
          <button class="tab-btn" data-tab="internal">📝 内部メモ</button>
        </div>
        <div class="tab-content tab-readout active">
          <div class="readout-text">${md(readAloud)}</div>
          <button class="btn-copy" data-copy="${escapeAttr(readAloud)}">📋 コピー</button>
        </div>
        <div class="tab-content tab-internal">
          <div class="readout-text">${md(internalNote)}</div>
          <button class="btn-copy" data-copy="${escapeAttr(internalNote)}">📋 コピー</button>
        </div>
      </div>
    `;
    }

    function generateReadAloud(record) {
        return `ご案内いたします。${record.answer || ''}`;
    }

    function buildSimpleAnswer(hit) {
        if (!hit) return '<div class="msg-bubble">回答が見つかりませんでした。</div>';
        const r = hit.record;
        return `
      <div class="wf-card">
        <div class="wf-card-title">💬 ${escapeHtml(r.title)}</div>
        <div class="card-section">${md(r.answer)}</div>
        <div class="evidence-chip">
          📄 ${escapeHtml(r.source_file)} ${r.source_page || ''} v${r.version} (${r.valid_from}版)
        </div>
        ${buildReadAloudTabs(generateReadAloud(r), r.answer)}
      </div>`;
    }

    function buildUnknownCard(policyResult, workflowResult) {
        const Policy = window.Policy;
        const msg = Policy.buildUnknownResponse(
            policyResult.reason,
            policyResult.missingInfo,
            policyResult.conflictInfo,
            workflowResult
        );

        let choiceHtml = '';
        if (policyResult.reason === 'unknown_workflow') {
            const choices = window.WorkflowMatcher.getAllChoices();
            choiceHtml = `<div class="workflow-choices">${choices.map(c => `<button class="btn-wf-choice" data-wf="${c.id}">${c.label}</button>`).join('')
                }</div>`;
        }

        return `<div class="unknown-card">${md(msg)}${choiceHtml}</div>`;
    }

    function buildFeedbackButtons() {
        return `
      <div class="feedback-label">この回答は役立ちましたか？</div>
      <button class="btn-fb" data-fb="resolved">✅ 解決した</button>
      <button class="btn-fb" data-fb="unhelpful">👎 役に立たない</button>
      <button class="btn-fb" data-fb="outdated">📅 情報が古い</button>
      <button class="btn-fb" data-fb="dangerous">⚠️ 言い切り（危険）</button>
    `;
    }

    function bindTabSwitchers(container) {
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabGroup = btn.closest('.talk-tabs');
                tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tabGroup.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const target = btn.dataset.tab;
                const el = tabGroup.querySelector(`.tab-${target}`);
                if (el) el.classList.add('active');
            });
        });
    }

    function bindCopyButtons(container) {
        container.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.copy || '';
                navigator.clipboard.writeText(text).then(() => {
                    btn.textContent = '✅ コピー済み';
                    setTimeout(() => { btn.textContent = '📋 コピー'; }, 2000);
                });
            });
        });
    }

    function appendSystemMessage(text) {
        removeThinking();
        const box = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = 'msg msg-system';
        div.innerHTML = `<div class="msg-bubble">${md(text)}</div>`;
        box.appendChild(div);
        scrollBottom();
    }

    function scrollBottom() {
        const box = document.getElementById('chat-messages');
        if (box) box.scrollTop = box.scrollHeight;
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(s) {
        return String(s || '').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
    }

    /**
     * RAG回答（ソース付きLLM回答）を表示
     */
    function appendRagMessage(answerText, sourceRecords) {
        removeThinking();
        const box = document.getElementById('chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg msg-bot';

        const sourceChips = (sourceRecords || []).map(r => `
            <div class="evidence-chip">
                📄 ${escapeHtml(r.title || r.id)} — ${escapeHtml(r.client || '共通')} / ${escapeHtml(r.project || '共通')} v${r.version || '1.0'}
            </div>
        `).join('');

        msgDiv.innerHTML = `
        <div class="wf-card" style="border-color: #2dd4a0; border-width: 2px;">
            <div style="background: linear-gradient(135deg, #2dd4a020, #10b98115); border-radius: 8px; padding: 0.6rem 1rem; margin-bottom: 0.75rem; display:flex; align-items:center; gap:0.5rem;">
                <span style="font-size:1.1rem;">📚</span>
                <span style="font-weight:600; color:#2dd4a0; font-size:0.85rem;">FAQソースに基づく回答</span>
            </div>
            <div class="card-section">${md(answerText)}</div>
            ${sourceChips ? `<div style="margin-top:0.75rem; border-top:1px solid var(--border); padding-top:0.5rem;">${sourceChips}</div>` : ''}
        </div>`;

        box.appendChild(msgDiv);

        const fbDiv = document.createElement('div');
        fbDiv.className = 'feedback-row';
        fbDiv.innerHTML = buildFeedbackButtons();
        box.appendChild(fbDiv);

        scrollBottom();
        return msgDiv;
    }

    /**
     * LLM一般知識による回答を警告付きで表示
     */
    function appendLlmMessage(answerText) {
        removeThinking();
        const box = document.getElementById('chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg msg-bot';

        msgDiv.innerHTML = `
        <div class="wf-card" style="border-color: #f5a623; border-width: 2px;">
            <div style="background: linear-gradient(135deg, #f5a62320, #ff8c0015); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; display:flex; align-items:center; gap:0.5rem;">
                <span style="font-size:1.2rem;">⚠️</span>
                <div>
                    <div style="font-weight:700; color:#f5a623; font-size:0.85rem;">根拠資料なし — AIによる参考回答</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">社内マニュアルに該当する情報が見つからなかったため、AIが一般知識から回答しています。正確な情報は担当部署にご確認ください。</div>
                </div>
            </div>
            <div class="card-section">${md(answerText)}</div>
        </div>`;

        box.appendChild(msgDiv);

        const fbDiv = document.createElement('div');
        fbDiv.className = 'feedback-row';
        fbDiv.innerHTML = buildFeedbackButtons();
        box.appendChild(fbDiv);

        scrollBottom();
        return msgDiv;
    }

    return { appendUserMessage, appendThinking, removeThinking, appendBotMessage, appendRagMessage, appendLlmMessage, appendSystemMessage, scrollBottom };
})();
