/**
 * app.js - メインアプリケーション統合・ルーティング・業務固定ロジック
 */
window.App = (() => {
    let allRecords = [];
    let pinnedWorkflow = null;
    let conversationCount = 0;

    async function init() {
        if (window.Auth.restore()) {
            startApp();
        } else {
            showScreen('login-screen');
        }

        // ログインフォーム
        document.getElementById('btn-login').addEventListener('click', handleLogin);
        document.getElementById('login-password').addEventListener('keydown', e => {
            if (e.key === 'Enter') handleLogin();
        });
    }

    function handleLogin() {
        const role = document.getElementById('login-role').value;
        const pwd = document.getElementById('login-password').value;
        const result = window.Auth.login(role, pwd);

        if (!result.ok) {
            document.getElementById('login-error').textContent = result.error;
            return;
        }

        document.getElementById('login-error').textContent = '';
        startApp(result.user);
    }

    async function startApp(user) {
        // userが渡されていない場合はsessionStorageから取得
        if (!user) user = window.Auth.getUser();

        showScreen('loading-screen');
        try {
            const data = await window.DataLoader.loadAll();
            const visible = window.DataLoader.filterByRole(data.records, user);
            allRecords = visible;

            // クライアント・施策のプルダウン初期化と履歴復元
            if (window.DataLoader.getClientProjectMap) {
                const cpMap = window.DataLoader.getClientProjectMap();
                setupContextSelectors(cpMap);
            }

            window.SearchEngine.buildIndex(allRecords);
            window.WorkflowMatcher.init(data.workflows);

            window.Logger.newSession();
            setupChatUI(user);
            showScreen('chat-screen');

            // ユーザー名表示
            document.getElementById('user-badge').textContent = `${user.label} でログイン中`;

            // 管理者メニュー
            if (window.Auth.canAccessAdmin()) {
                document.getElementById('btn-admin').style.display = 'inline-flex';
            }


            // textarea自動リサイズ設定
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.addEventListener('input', function () {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                });
            }

            Chat.appendSystemMessage('🟢 FAQシステムが起動しました。質問を入力してください。\n\n⚠️ 個人情報（電話番号・会員番号・メールアドレス等）はこのシステムに入力しないでください。');
        } catch (e) {
            console.error('Initial data load failed:', e);
            showScreen('login-screen');
            document.getElementById('login-error').textContent = 'データ読み込みに失敗しました: ' + e.message;
        }
    }

    function setupChatUI(user) {
        const input = document.getElementById('chat-input');
        const btn = document.getElementById('btn-send');

        btn.addEventListener('click', () => sendQuery(input.value.trim(), user));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(input.value.trim(), user); }
        });

        // クイックサジェストボタン
        document.querySelectorAll('.btn-suggest').forEach(sgBtn => {
            sgBtn.addEventListener('click', () => {
                input.value = sgBtn.textContent;
                input.style.height = 'auto'; // 高さをリセット
                sendQuery(input.value.trim(), user);
            });
        });

        // ログアウト
        document.getElementById('btn-logout').addEventListener('click', () => {
            window.Auth.logout();
            allRecords = [];
            pinnedWorkflow = null;
            document.getElementById('chat-messages').innerHTML = '';
            showScreen('login-screen');
        });

        // 管理者ボタン
        document.getElementById('btn-admin').addEventListener('click', () => {
            sessionStorage.setItem('cc_admin_session', '1');
            window.location.href = 'admin.html';
        });



        // ピン解除
        document.getElementById('btn-unpin').addEventListener('click', () => {
            pinnedWorkflow = null;
            document.getElementById('pinned-badge').style.display = 'none';
            document.getElementById('btn-unpin').style.display = 'none';
        });

        // エスカレーションボタン（動的）
        document.getElementById('chat-messages').addEventListener('click', e => {
            if (e.target.matches('.btn-wf-choice')) {
                const wfId = e.target.dataset.wf;
                // 選択した業務で再検索
                const lastQuery = input.dataset.lastQuery || '';
                handleWorkflowChoice(wfId, lastQuery, user);
            }
            if (e.target.matches('.btn-fb')) {
                handleFeedback(e.target.dataset.fb, e.target.closest('.feedback-row'));
            }
        });
    }

    async function sendQuery(query, user) {
        if (!query) return;
        const input = document.getElementById('chat-input');
        input.value = '';
        input.dataset.lastQuery = query;
        conversationCount++;

        Chat.appendUserMessage(query);
        Chat.appendThinking();

        await sleep(300); // 視覚的な間

        const client = document.getElementById('sel-client') ? document.getElementById('sel-client').value : 'all';
        const project = document.getElementById('sel-project') ? document.getElementById('sel-project').value : 'all';

        let hits = window.SearchEngine.search(query, 8, { client, project });

        // ステージ1.5: FlexSearchヒットなし → 日本語部分文字列フォールバック
        if (hits.length === 0) {
            hits = window.SearchEngine.fallbackSearch(query, 8, { client, project });
        }

        // ===== ステージ2: RAG回答（毎回実行）=====
        // FlexSearchの結果に関わらず、LLMにFAQ全体を渡して正確な回答を生成
        if (window.LlmChat) {
            try {
                const ragResult = await window.LlmChat.ragAnswer(query, allRecords);

                if (ragResult.hasSource && ragResult.answer) {
                    // ソースが見つかった → RAG回答を表示
                    const sourceRecords = ragResult.sourceIds
                        .map(id => allRecords.find(r => r.id === id))
                        .filter(Boolean);

                    // ログ記録
                    window.Logger.record({
                        role: user.role,
                        userQuestion: query,
                        workflowCandidates: [],
                        selectedWorkflow: null,
                        hitDocs: ragResult.sourceIds,
                        resultType: 'rag_answer',
                        topScore: 1.0,
                        needsReview: false
                    });

                    Chat.appendRagMessage(ragResult.answer, sourceRecords);
                    return;
                }

                // ソースなし → LLM一般知識回答
                if (!ragResult.hasSource) {
                    const freeAnswer = await window.LlmChat.generateFreeAnswer(query);
                    if (freeAnswer && freeAnswer.trim()) {
                        window.Logger.record({
                            role: user.role,
                            userQuestion: query,
                            workflowCandidates: [],
                            selectedWorkflow: null,
                            hitDocs: [],
                            resultType: 'llm_fallback',
                            topScore: 0,
                            needsReview: false
                        });
                        Chat.appendLlmMessage(freeAnswer);
                        return;
                    }
                }
            } catch (e) {
                console.warn('RAG/LLM failed, falling back to text search:', e);
            }
        }

        // ===== フォールバック: LLM使用不可時はテキスト検索結果で表示 =====
        // 業務固定中なら強制的にそのworkflowを使う
        let workflowResult;
        if (pinnedWorkflow) {
            workflowResult = {
                primary: { workflow: pinnedWorkflow, score: 99 },
                candidates: [{ workflow: pinnedWorkflow, score: 99 }],
                mode: 'single'
            };
        } else {
            workflowResult = window.WorkflowMatcher.determine(query, hits);
        }

        const policyResult = window.Policy.evaluate(query, hits, workflowResult);

        // ログ記録
        window.Logger.record({
            role: user.role,
            userQuestion: query,
            workflowCandidates: workflowResult.candidates ? workflowResult.candidates.map(c => c.workflow.workflow_id) : [],
            selectedWorkflow: workflowResult.primary ? workflowResult.primary.workflow.workflow_id : null,
            hitDocs: hits.map(h => h.record.id),
            resultType: policyResult.canAnswer === true ? 'found' : 'not_found',
            topScore: hits[0] ? hits[0].score : 0,
            needsReview: policyResult.reason === 'conflict'
        });

        Chat.appendBotMessage({ hits, workflowResult, policyResult, query });

        // 業務ピン提案（複数回同じ業務が出た場合）
        if (workflowResult.primary && workflowResult.mode === 'single' && !pinnedWorkflow) {
            if (conversationCount >= 2) {
                showPinProposal(workflowResult.primary.workflow);
            }
        }
    }

    function showPinProposal(wf) {
        const badge = document.getElementById('pin-proposal');
        if (!badge) return;
        badge.innerHTML = `この会話を <strong>${wf.workflow_name}</strong> 業務として進めますか？
      <button id="btn-pin-confirm">固定する</button>
      <button id="btn-pin-dismiss">いいえ</button>`;
        badge.style.display = 'flex';

        document.getElementById('btn-pin-confirm').onclick = () => {
            pinnedWorkflow = wf;
            badge.style.display = 'none';
            document.getElementById('pinned-badge').textContent = `📌 ${wf.workflow_name} 業務固定中`;
            document.getElementById('pinned-badge').style.display = 'inline-flex';
            document.getElementById('btn-unpin').style.display = 'inline-flex';
        };
        document.getElementById('btn-pin-dismiss').onclick = () => { badge.style.display = 'none'; };
    }

    function handleWorkflowChoice(wfId, lastQuery, user) {
        const wf = window.DataLoader.getWorkflows().find(w => w.workflow_id === wfId);
        if (!wf) return;

        const client = document.getElementById('sel-client') ? document.getElementById('sel-client').value : 'all';
        const project = document.getElementById('sel-project') ? document.getElementById('sel-project').value : 'all';

        const hits = window.SearchEngine.search(lastQuery || wf.workflow_name, 8, { client, project });
        const workflowResult = {
            primary: { workflow: wf },
            candidates: [{ workflow: wf }],
            mode: 'single'
        };
        const policyResult = window.Policy.evaluate(lastQuery, hits, workflowResult);
        Chat.appendBotMessage({ hits, workflowResult, policyResult, query: lastQuery });
    }



    function handleFeedback(type, rowEl) {
        window.Logger.updateLastFeedback(type);
        const labels = { resolved: '解決', unhelpful: '役に立たない', outdated: '情報が古い', dangerous: '言い切り（危険）' };
        if (rowEl) {
            rowEl.innerHTML = `<span class="fb-done">フィードバックありがとうございます: ${labels[type] || type}</span>`;
        }
    }



    function setupContextSelectors(cpMap) {
        const clientSel = document.getElementById('sel-client');
        const projectSel = document.getElementById('sel-project');
        const container = document.getElementById('context-selectors');
        if (!clientSel || !projectSel || !container) return;

        clientSel.innerHTML = '<option value="all">🌐 全クライアント</option>';
        Object.keys(cpMap).sort().forEach(client => {
            const opt = document.createElement('option');
            opt.value = client;
            opt.textContent = client;
            clientSel.appendChild(opt);
        });

        const savedClient = sessionStorage.getItem('cc_client') || 'all';
        const savedProject = sessionStorage.getItem('cc_project') || 'all';

        clientSel.addEventListener('change', () => {
            const selectedClient = clientSel.value;
            sessionStorage.setItem('cc_client', selectedClient);
            sessionStorage.removeItem('cc_project');

            projectSel.innerHTML = '<option value="all">📂 全施策・案件</option>';
            if (selectedClient === 'all') {
                projectSel.disabled = true;
            } else {
                projectSel.disabled = false;
                const projects = cpMap[selectedClient] || [];
                projects.forEach(proj => {
                    const opt = document.createElement('option');
                    opt.value = proj;
                    opt.textContent = proj;
                    projectSel.appendChild(opt);
                });
            }
        });

        projectSel.addEventListener('change', () => {
            sessionStorage.setItem('cc_project', projectSel.value);
        });

        if (savedClient !== 'all' && cpMap[savedClient]) {
            clientSel.value = savedClient;
            clientSel.dispatchEvent(new Event('change'));
            if (savedProject !== 'all' && cpMap[savedClient].includes(savedProject)) {
                projectSel.value = savedProject;
                projectSel.dispatchEvent(new Event('change'));
            }
        }

        container.style.display = 'flex';
    }

    function showScreen(id) {
        ['login-screen', 'loading-screen', 'chat-screen'].forEach(s => {
            const el = document.getElementById(s);
            if (el) el.style.display = s === id ? 'flex' : 'none';
        });
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
