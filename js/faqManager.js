/**
 * faqManager.js - 初期データ移行（faq.json -> CSVエクスポート）機能
 */
document.addEventListener('DOMContentLoaded', () => {
    const btnExportCsv = document.getElementById('btn-export-faq-csv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', async () => {
            const statusEl = document.getElementById('faq-export-status');
            statusEl.textContent = '生成中...';
            statusEl.style.color = 'var(--text-secondary)';

            try {
                // ローカルの faq.json を読み込む
                // パスは admin.html から見た相対パス
                const res = await fetch('./data/faq.json');
                if (!res.ok) throw new Error('faq.jsonの読み込みに失敗しました');
                const data = await res.json();
                const records = data.records || [];

                if (records.length === 0) {
                    throw new Error('エクスポートするFAQデータがありません');
                }

                // CSVヘッダー（スプレッドシートの1行目に対応）
                const headers = [
                    'id', 'title', 'question', 'answer', 'category', 'product', 'channel',
                    'valid_from', 'valid_until', 'version', 'source_file', 'source_page',
                    'confidentiality', 'tags', 'required_info', 'workflow_ids', 'step_phase',
                    'priority_in_workflow', 'conflict_group'
                ];

                // CSV行の生成
                const csvRows = [headers.join(',')];
                for (const r of records) {
                    const row = headers.map(h => {
                        let val = r[h];
                        if (val === undefined || val === null) val = '';
                        // 配列はカンマ区切り文字列に
                        if (Array.isArray(val)) val = val.join(',');

                        // 文字列内のダブルクォートをエスケープし、全体をダブルクォートで囲む
                        val = String(val).replace(/"/g, '""');
                        return `"${val}"`;
                    });
                    csvRows.push(row.join(','));
                }

                // BOM付きCSV
                const csvContent = "\uFEFF" + csvRows.join("\r\n");
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `faq_export_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                statusEl.textContent = '✅ ダウンロード完了';
                statusEl.style.color = 'var(--text-success)';
                setTimeout(() => statusEl.textContent = '', 3000);

            } catch (error) {
                console.error('FAQエクスポートエラー:', error);
                statusEl.textContent = `❌ エラー: ${error.message}`;
                statusEl.style.color = 'var(--text-danger)';
            }
        });
    }
});
