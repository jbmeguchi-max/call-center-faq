/**
 * workflowMatcher.js - 業務判定・スコアリング・複数業務合成
 */
window.WorkflowMatcher = (() => {
    const WORKFLOW_THRESHOLD = 2.0; // 業務スコアの閾値
    let workflows = [];

    function init(wfs) { workflows = wfs; }

    /**
     * 業務スコアリング
     * スコア = キーワード一致数×2 + 検索ヒットのworkflow_ids一致数
     * @param {string} query ユーザー入力
     * @param {Array} searchHits SearchEngine.search()の結果
     * @returns {Array} [{workflow, score, matchedKeywords}] 降順ソート済み
     */
    function score(query, searchHits) {
        const q = query.toLowerCase();
        const scoreMap = {};

        workflows.forEach(wf => {
            scoreMap[wf.workflow_id] = {
                workflow: wf,
                score: 0,
                matchedKeywords: [],
                hitDocs: []
            };

            // キーワード一致スコア
            (wf.keywords || []).forEach(kw => {
                if (q.includes(kw.toLowerCase())) {
                    scoreMap[wf.workflow_id].score += 2;
                    scoreMap[wf.workflow_id].matchedKeywords.push(kw);
                }
            });
        });

        // 検索ヒットのworkflow_idsからスコア加算
        searchHits.forEach(hit => {
            (hit.record.workflow_ids || []).forEach(wid => {
                if (scoreMap[wid]) {
                    scoreMap[wid].score += hit.score;
                    if (!scoreMap[wid].hitDocs.includes(hit.record.id)) {
                        scoreMap[wid].hitDocs.push(hit.record.id);
                    }
                }
            });
        });

        return Object.values(scoreMap)
            .filter(v => v.score > 0)
            .sort((a, b) => b.score - a.score);
    }

    /**
     * 業務の確定判定（最大3件）
     * @returns { primary, candidates, mode }
     *   mode: 'single' | 'multi' | 'unknown'
     */
    function determine(query, searchHits) {
        const ranked = score(query, searchHits);

        if (ranked.length === 0 || ranked[0].score < WORKFLOW_THRESHOLD) {
            return { primary: null, candidates: [], mode: 'unknown', ranked };
        }

        const top = [ranked[0]];
        for (let i = 1; i < ranked.length && i < 3; i++) {
            if (ranked[i].score >= WORKFLOW_THRESHOLD) top.push(ranked[i]);
        }

        return {
            primary: top[0],
            candidates: top,
            mode: top.length >= 2 ? 'multi' : 'single',
            ranked
        };
    }

    /** 業務候補の選択肢ボタン用リスト（全ワークフロー） */
    function getAllChoices() {
        return workflows.map(wf => ({ id: wf.workflow_id, label: wf.workflow_name }));
    }

    return { init, score, determine, getAllChoices };
})();
