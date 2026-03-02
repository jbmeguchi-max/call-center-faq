/**
 * search.js - FlexSearch統合・全文検索・スコア閾値判定
 * FlexSearchはCDNからロード済みを前提とする
 */
window.SearchEngine = (() => {
    const SCORE_THRESHOLD = 0.05; // ヒット判定閾値（カジュアルな表現でもヒットするよう低めに設定）
    let index = null;
    let records = [];

    function buildIndex(recs) {
        records = recs;
        // FlexSearchのDocument index
        index = new FlexSearch.Document({
            tokenize: 'full',
            cache: true,
            document: {
                id: 'id',
                index: [
                    { field: 'title', tokenize: 'full', weight: 3 },
                    { field: 'question', tokenize: 'full', weight: 3 },
                    { field: 'answer', tokenize: 'forward', weight: 2 },
                    { field: 'tags', tokenize: 'full', weight: 2 },
                    { field: 'search_keywords', tokenize: 'full', weight: 3 },
                    { field: 'client', tokenize: 'full', weight: 2 },
                    { field: 'project', tokenize: 'full', weight: 2 },
                    { field: 'category', tokenize: 'full', weight: 1 }
                ]
            }
        });

        records.forEach(r => {
            index.add({
                id: r.id,
                title: r.title || '',
                question: r.question || '',
                answer: r.answer || '',
                tags: (r.tags || []).join(' '),
                search_keywords: (r.search_keywords || '').toString(),
                client: (r.client || '').toString(),
                project: (r.project || '').toString(),
                category: r.category || ''
            });
        });
    }

    /**
     * 検索実行
     * @returns {Array} [{record, score, fieldHits}]
     */
    function search(query, limit = 10, options = {}) {
        if (!index || !query.trim()) return [];

        // フィルタリングで削られる分を見越して多めに取得
        const results = index.search(query, { limit: 100, enrich: true });
        const scoreMap = {};
        const fieldWeights = { title: 3, question: 3, answer: 2, tags: 2, search_keywords: 3, client: 2, project: 2, category: 1 };

        results.forEach(fieldResult => {
            const weight = fieldWeights[fieldResult.field] || 1;
            (fieldResult.result || []).forEach((item, idx) => {
                const id = typeof item === 'object' ? item.id : item;
                if (!scoreMap[id]) scoreMap[id] = { score: 0, fields: [] };
                // 位置によるスコア減衰（上位ほど高スコア）
                scoreMap[id].score += weight * (1 / (idx + 1));
                scoreMap[id].fields.push(fieldResult.field);
            });
        });

        // 正規化（最大スコアを1.0として相対化）
        const maxScore = Math.max(...Object.values(scoreMap).map(v => v.score), 0.001);
        const hits = Object.entries(scoreMap).map(([id, val]) => ({
            record: records.find(r => r.id === id),
            score: val.score / maxScore,
            rawScore: val.score,
            fieldHits: val.fields
        })).filter(h => {
            if (!h.record) return false;
            if (h.score < SCORE_THRESHOLD) return false;

            // クライアント・施策のフィルタリング
            if (options.client && options.client !== 'all') {
                const recClient = h.record.client || '共通';
                if (recClient !== '共通' && recClient !== options.client) {
                    return false;
                }
            }
            if (options.project && options.project !== 'all') {
                const recProject = h.record.project || '共通';
                if (recProject !== '共通' && recProject !== options.project) {
                    return false;
                }
            }
            return true;
        });

        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, limit);
    }

    /**
     * 日本語フォールバック検索:
     * FlexSearchでヒットしない場合に、3文字以上の共通部分文字列で検索する
     */
    function fallbackSearch(query, limit = 5, options = {}) {
        if (!query || query.length < 2) return [];

        const q = query.toLowerCase();
        const minSubLen = Math.min(3, q.length); // 最低3文字の共通部分

        const scored = records.map(r => {
            // クライアント・施策フィルタ
            if (options.client && options.client !== 'all') {
                const recClient = (r.client || '共通').toString().trim();
                if (recClient !== '共通' && recClient !== options.client) return null;
            }
            if (options.project && options.project !== 'all') {
                const recProject = (r.project || '共通').toString().trim();
                if (recProject !== '共通' && recProject !== options.project) return null;
            }

            const title = (r.title || '').toLowerCase();
            const question = (r.question || '').toLowerCase();
            const keywords = (r.search_keywords || '').toString().toLowerCase();
            const clientStr = (r.client || '').toString().toLowerCase();
            const projectStr = (r.project || '').toString().toLowerCase();

            let matchScore = 0;

            // タイトル・質問・クライアント・施策がクエリに含まれる or その逆
            if (title && (q.includes(title) || title.includes(q))) matchScore += 5;
            if (question && (q.includes(question) || question.includes(q))) matchScore += 5;
            if (clientStr && clientStr.length >= 2 && q.includes(clientStr)) matchScore += 4;
            if (projectStr && projectStr.length >= 2 && q.includes(projectStr)) matchScore += 4;

            // 3文字以上の共通部分文字列でスコアリング
            if (matchScore === 0) {
                const targets = [title, question, keywords, clientStr, projectStr];
                for (let len = Math.min(q.length, 8); len >= minSubLen; len--) {
                    for (let i = 0; i <= q.length - len; i++) {
                        const sub = q.substring(i, i + len);
                        if (targets.some(t => t.includes(sub))) {
                            matchScore += len;
                            break;
                        }
                    }
                    if (matchScore > 0) break;
                }
            }

            if (matchScore === 0) return null;
            return {
                record: r,
                score: Math.min(matchScore / 10, 0.9),
                rawScore: matchScore,
                fieldHits: ['fallback']
            };
        }).filter(Boolean);

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
    }

    function getThreshold() { return SCORE_THRESHOLD; }
    function getRecords() { return records; }

    return { buildIndex, search, fallbackSearch, getThreshold, getRecords };
})();
