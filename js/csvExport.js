/**
 * csvExport.js - ログCSVダウンロード（管理者専用）
 */
window.CsvExport = (() => {
    const COLUMNS = [
        'session_id', 'timestamp', 'role', 'user_question',
        'workflow_candidates', 'selected_workflow', 'hit_docs',
        'result_type', 'top_score', 'resolved', 'feedback', 'escalated', 'needs_review'
    ];

    function escapeCSV(val) {
        if (val === null || val === undefined) return '';
        const s = Array.isArray(val) ? val.join('|') : String(val);
        // ダブルクォートで囲む（カンマ・改行対策）
        return '"' + s.replace(/"/g, '""') + '"';
    }

    function download(logs) {
        const header = COLUMNS.join(',');
        const rows = logs.map(log =>
            COLUMNS.map(col => escapeCSV(log[col])).join(',')
        );
        const csv = '\uFEFF' + [header, ...rows].join('\r\n'); // BOM付きUTF-8

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `cc_faq_logs_${ts}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return { download };
})();
