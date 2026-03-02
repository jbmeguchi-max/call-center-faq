/**
 * llmChat.js - RAG (Retrieval Augmented Generation) ベースのFAQ回答
 *
 * NotebookLM方式: 全FAQデータをコンテキストとしてLLMに渡し、
 * ソースに基づいた正確な回答を生成する
 */
window.LlmChat = (() => {
    const PROVIDERS = {
        groq: {
            name: 'Groq',
            apiKey: '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',
            model: 'llama-3.3-70b-versatile'
        },
        gemini: {
            name: 'Gemini',
            apiKey: 'AIzaSyARJgJ7B7AgSSeDDHNEGnghQOJ9slztikI',
            model: 'gemini-2.0-flash-lite'
        }
    };

    /**
     * RAG回答: 全FAQソースを渡して、ソースに基づいた回答を生成
     * @returns {{ answer: string, sourceIds: string[], hasSource: boolean }}
     */
    async function ragAnswer(query, allRecords) {
        // FAQデータをコンテキストとして整形（完全な内容を含む）
        const faqContext = allRecords.map(r =>
            `[FAQ ID: ${r.id}]\n` +
            `クライアント: ${r.client || '共通'}\n` +
            `施策: ${r.project || '共通'}\n` +
            `カテゴリ: ${r.category || ''}\n` +
            `タイトル: ${r.title || ''}\n` +
            `質問: ${r.question || ''}\n` +
            `回答: ${r.answer || ''}\n`
        ).join('\n---\n');

        const prompt = `あなたはコールセンターのFAQ検索アシスタントです。
以下のFAQデータベースの中から、ユーザーの質問に最も関連する情報を見つけて回答してください。

【絶対ルール】
1. FAQデータベースに該当する情報がある場合は、その内容に基づいて正確に回答してください
2. 回答の最後に、参照したFAQ IDを必ず記載してください
3. 複数のFAQが関連する場合は、すべて参照してください
4. FAQデータベースに該当する情報が全くない場合のみ、"NO_SOURCE" と回答してください
5. FAQの内容を勝手に変えたり追加したりせず、ソースに忠実に回答してください
6. 回答はお客様に説明するような丁寧で分かりやすい日本語にしてください

【FAQデータベース】
${faqContext}

【ユーザーの質問】
${query}

【出力フォーマット】
回答部分を先に書き、最後の行に以下の形式でソースを記載してください:
SOURCE_IDS: [id1, id2, ...]

該当なしの場合:
NO_SOURCE`;

        try {
            const response = await callLLMWithFallback(prompt);

            // NO_SOURCE チェック
            if (response.trim() === 'NO_SOURCE' || response.includes('NO_SOURCE')) {
                return { answer: null, sourceIds: [], hasSource: false };
            }

            // SOURCE_IDs の抽出
            const sourceMatch = response.match(/SOURCE_IDS?\s*:\s*\[([^\]]*)\]/i);
            let sourceIds = [];
            if (sourceMatch) {
                sourceIds = sourceMatch[1]
                    .split(',')
                    .map(s => s.trim().replace(/['"]/g, ''))
                    .filter(Boolean);
            }

            // 回答部分（SOURCE_IDS行を除去）
            let answer = response
                .replace(/SOURCE_IDS?\s*:\s*\[.*\]/i, '')
                .trim();

            return {
                answer: answer,
                sourceIds: sourceIds,
                hasSource: sourceIds.length > 0
            };
        } catch (error) {
            console.error('RAG answer failed:', error);
            throw error;
        }
    }

    /**
     * LLM一般知識回答（FAQに該当なし時のフォールバック）
     */
    async function generateFreeAnswer(query) {
        const prompt = `あなたはコールセンターのオペレーターを支援するAIアシスタントです。
以下のお客様からの質問に対して、一般的な知識に基づいて丁寧に回答してください。

【重要な注意事項】
- この回答は社内マニュアルや根拠資料に基づいていません
- 断定的な表現は避け、「一般的には」「通常は」などの表現を使ってください
- 正確な情報が必要な場合は「詳しくは担当部署にご確認ください」と案内してください
- 簡潔に3〜5文程度で回答してください

【お客様の質問】
${query}`;

        return await callLLMWithFallback(prompt);
    }

    /**
     * LLM呼び出し（Groq優先 → Geminiフォールバック）
     */
    async function callLLMWithFallback(prompt) {
        try {
            return await callGroq(prompt);
        } catch (groqError) {
            console.warn('Groq failed, falling back to Gemini:', groqError.message);
            try {
                return await callGemini(prompt);
            } catch (geminiError) {
                throw new Error(`LLM呼び出し失敗: Groq(${groqError.message}) / Gemini(${geminiError.message})`);
            }
        }
    }

    async function callGroq(prompt) {
        const p = PROVIDERS.groq;
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${p.apiKey}`
            },
            body: JSON.stringify({
                model: p.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 2048
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Groq ${res.status}: ${errText.substring(0, 100)}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async function callGemini(prompt) {
        const p = PROVIDERS.gemini;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini ${res.status}: ${errText.substring(0, 100)}`);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    return { ragAnswer, generateFreeAnswer };
})();
