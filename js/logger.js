/**
 * logger.js - LocalStorageロギング・個人情報マスキング・業務候補記録
 */
window.Logger = (() => {
    const STORAGE_KEY = 'cc_faq_logs';
    const MAX_LOGS = 500;

    // 個人情報マスキングパターン
    const MASK_PATTERNS = [
        { pattern: /\b0\d{9,10}\b/g, mask: '[電話番号]' },
        { pattern: /\b\d{7,}\b/g, mask: '[番号]' },
        { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: '[メールアドレス]' },
        { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: '[カード番号]' }
    ];

    function maskPII(text) {
        let result = text || '';
        MASK_PATTERNS.forEach(({ pattern, mask }) => {
            result = result.replace(pattern, mask);
        });
        return result;
    }

    function generateSessionId() {
        return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    let sessionId = generateSessionId();

    function record(entry) {
        const logs = getLogs();
        const log = {
            session_id: sessionId,
            timestamp: new Date().toISOString(),
            role: entry.role || 'unknown',
            user_question: maskPII(entry.userQuestion || ''),
            workflow_candidates: entry.workflowCandidates || [],
            selected_workflow: entry.selectedWorkflow || null,
            hit_docs: entry.hitDocs || [],
            result_type: entry.resultType || 'unknown',   // found / not_found / escalated / forbidden
            top_score: entry.topScore || 0,
            resolved: entry.resolved || false,
            feedback: entry.feedback || null,           // resolved / unhelpful / outdated / dangerous
            escalated: entry.escalated || false,
            needs_review: entry.needsReview || false
        };
        logs.push(log);

        // 上限超えたら古いものを削除
        if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
        } catch (e) {
            console.warn('ログ保存失敗:', e);
        }
        return log;
    }

    function getLogs() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch { return []; }
    }

    function clearLogs() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function updateLastFeedback(feedback) {
        const logs = getLogs();
        if (logs.length === 0) return;
        logs[logs.length - 1].feedback = feedback;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    }

    function updateLastEscalated() {
        const logs = getLogs();
        if (logs.length === 0) return;
        logs[logs.length - 1].escalated = true;
        logs[logs.length - 1].result_type = 'escalated';
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    }

    function newSession() {
        sessionId = generateSessionId();
    }

    return { record, getLogs, clearLogs, updateLastFeedback, updateLastEscalated, newSession, maskPII };
})();
