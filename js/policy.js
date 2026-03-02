/**
 * policy.js - 回答ポリシー・「分からない」判定・矛盾検出・禁止フレーズチェック
 */
window.Policy = (() => {
    // 禁止フレーズ（オペレーターが言ってはいけない表現）
    const FORBIDDEN_PHRASES = [
        '確約', '保証します', '絶対に', '必ず対応', 'お約束', '補償します',
        '今回だけ特別', '例外として', '会社として保証', '法律上問題ない',
        '契約を変更', '金額を確定'
    ];

    // 「分からない」判定に必要な埋まっていない情報を検出するキーワード
    const REQUIRED_INFO_HINTS = {
        '商品名': ['商品', '製品', '品名'],
        '購入日': ['いつ', '日付', '購入日'],
        '注文番号': ['注文', '番号'],
        '会員番号': ['会員', 'ID'],
        '契約種別': ['月額', '年額', '契約'],
        '決済方法': ['支払い', 'クレジット', '振込'],
        '利用端末': ['端末', 'PC', 'スマホ', 'iPhone', 'Android']
    };

    /**
     * 回答可否の判定
     * @returns {object} { canAnswer, reason, missingInfo, conflictInfo }
     */
    function evaluate(query, searchHits, workflowResult) {
        // 禁止フレーズチェック
        const forbidden = checkForbiddenPhrases(query);
        if (forbidden.length > 0) {
            return {
                canAnswer: false,
                reason: 'forbidden',
                forbiddenPhrases: forbidden,
                missingInfo: [],
                conflictInfo: null
            };
        }

        // ヒットなし
        if (!searchHits || searchHits.length === 0) {
            return {
                canAnswer: false,
                reason: 'no_hit',
                missingInfo: [],
                conflictInfo: null
            };
        }

        // 業務不明 — ヒットがある場合はシンプル回答に回すので、ここではブロックしない
        // ヒットがない場合のみ unknown_workflow で選択肢を表示する
        if (workflowResult && workflowResult.mode === 'unknown' && (!searchHits || searchHits.length === 0)) {
            return {
                canAnswer: false,
                reason: 'unknown_workflow',
                missingInfo: [],
                conflictInfo: null
            };
        }

        // 矛盾検出
        const conflict = detectConflict(searchHits);
        if (conflict) {
            return {
                canAnswer: false,
                reason: 'conflict',
                missingInfo: [],
                conflictInfo: conflict
            };
        }

        // 必須情報不足チェック（上位ヒットのrequired_infoを参照）
        const topHit = searchHits[0];
        const missing = checkMissingInfo(query, topHit.record.required_info || []);
        if (missing.length > 0) {
            return {
                canAnswer: 'partial',
                reason: 'missing_info',
                missingInfo: missing,
                conflictInfo: null
            };
        }

        return { canAnswer: true, reason: 'ok', missingInfo: [], conflictInfo: null };
    }

    /**
     * 矛盾検出: 同一conflict_groupのヒットが複数あり、回答内容が異なる場合
     */
    function detectConflict(hits) {
        const groups = {};
        hits.forEach(h => {
            const cg = h.record.conflict_group;
            if (!cg) return;
            if (!groups[cg]) groups[cg] = [];
            groups[cg].push(h);
        });

        for (const [group, items] of Object.entries(groups)) {
            if (items.length >= 2) {
                // バージョンが異なる且つ回答が異なる → 矛盾
                const versions = items.map(i => parseInt(i.record.version || '0', 10));
                const maxV = Math.max(...versions);
                const conflicting = items.filter(i => parseInt(i.record.version || '0', 10) < maxV);
                if (conflicting.length > 0) {
                    return {
                        group,
                        items: items.map(i => ({
                            id: i.record.id,
                            title: i.record.title,
                            version: i.record.version,
                            source: i.record.source_file
                        }))
                    };
                }
            }
        }
        return null;
    }

    /** 禁止フレーズチェック */
    function checkForbiddenPhrases(query) {
        return FORBIDDEN_PHRASES.filter(p => query.includes(p));
    }

    /** 必須情報の不足チェック（質問文にヒントワードがなければ不足と判定） */
    function checkMissingInfo(query, requiredInfo) {
        const q = query;
        return requiredInfo.filter(info => {
            const hints = REQUIRED_INFO_HINTS[info] || [info];
            return !hints.some(h => q.includes(h));
        });
    }

    /**
     * 「分からない」テンプレ文生成
     */
    function buildUnknownResponse(reason, missingInfo, conflictInfo, workflowResult) {
        const lines = [];

        if (reason === 'forbidden') {
            lines.push('⚠️ **この質問はオペレーターが回答できない領域です。**');
            lines.push('確約・法務判断・個別例外対応の確約は行えません。SVにエスカレーションしてください。');
        } else if (reason === 'no_hit') {
            lines.push('🔍 **該当する根拠資料が見つからないため、断定できません。**');
        } else if (reason === 'unknown_workflow') {
            lines.push('❓ **業務が特定できませんでした。** 以下のいずれかをご選択ください。');
        } else if (reason === 'conflict') {
            lines.push('⚠️ **資料間で矛盾の可能性があるため、断定できません。**');
            if (conflictInfo) {
                lines.push('\n**衝突している資料：**');
                conflictInfo.items.forEach(i => {
                    lines.push(`- ${i.title}（${i.source} v${i.version}）`);
                });
            }
        } else if (reason === 'missing_info') {
            lines.push('📋 **回答に必要な情報が不足しています。**');
        }

        if (missingInfo && missingInfo.length > 0) {
            lines.push('\n**確認に必要な情報：**');
            missingInfo.forEach(info => lines.push(`- ${info}`));
        }

        lines.push('\n**エスカレーション先：** SVまたは業務窓口（チケット起票）');

        return lines.join('\n');
    }

    return { evaluate, detectConflict, checkForbiddenPhrases, buildUnknownResponse };
})();
