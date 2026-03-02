/**
 * dataLoader.js - JSONデータ読み込み・版管理・有効日フィルタ
 */
window.DataLoader = (() => {
    let allRecords = [];
    let workflows = [];
    let catalog = [];
    let clientProjectMap = {}; // クライアントと施策の階層マップ

    const SPREADSHEET_ID = '1ohexVmYipYE5aAB8z-8PGVPgUz2QGvQ1lZj0vPbcHlE';
    const API_KEY = 'AIzaSyBHDYguaml7GIz_8TpGkaO1waymmvGyk-U';

    async function loadAll() {
        const base = './data/';

        // 1. まずスプレッドシートの情報から1つ目のシート名を取得する
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${API_KEY}&fields=sheets.properties`;
        let sheetRes;
        try {
            const metaRes = await fetch(metaUrl, { cache: 'no-store' });
            if (!metaRes.ok) throw new Error(`メタデータ取得失敗: ${metaRes.status}`);

            const metaData = await metaRes.json();
            const firstSheetName = metaData.sheets && metaData.sheets[0] && metaData.sheets[0].properties ? metaData.sheets[0].properties.title : 'FAQ';

            // 2. 取得したシート名を使ってデータ本体を取得する
            const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(firstSheetName)}?key=${API_KEY}`;
            sheetRes = await fetch(sheetUrl, { cache: 'no-store' });
        } catch (e) {
            console.warn('Sheets API request failed, will fallback:', e);
            // ダミーレスポンスを作成してPromise.allを通す
            sheetRes = { ok: false, text: async () => 'Fetch error' };
        }

        const [manualData, workflowData, catalogData] = await Promise.all([
            fetchJSON(base + 'manuals.json'),
            fetchJSON(base + 'workflows.json'),
            fetchJSON(base + 'catalog.json')
        ]);

        let faqRecords = [];
        try {
            if (sheetRes.ok) {
                const sheetData = await sheetRes.json();
                faqRecords = parseSheetData(sheetData);
            } else {
                const errorText = await sheetRes.text().catch(() => '');
                console.warn('スプレッドシートのHTTPステータスエラー:', sheetRes.status, errorText);
                throw new Error(`Sheets API responded with status: ${sheetRes.status}`);
            }
        } catch (error) {
            console.warn('スプレッドシートへの通信に失敗しました:', error);
            console.warn('原因として以下が考えられます: 1. APIキーの制限設定によるブロック 2. ネットワークエラー 3. スプレッドシートが存在しないか権限がない');
            console.warn('ローカルのJSON (data/faq.json) にフォールバックします');
            try {
                const localFaq = await fetchJSON(base + 'faq.json');
                faqRecords = localFaq.records || [];
            } catch (localErr) {
                console.error('ローカルフォールバックにも失敗しました', localErr);
                throw new Error('データの読み込みに完全に失敗しました。ネットワークとAPI設定を確認してください。');
            }
        }

        const today = new Date().toISOString().split('T')[0];

        // FAQ + マニュアルをマージし有効日フィルタを適用
        const raw = [...faqRecords, ...(manualData.records || [])];
        allRecords = applyVersionFilter(applyDateFilter(raw, today));
        workflows = workflowData.workflows || [];
        catalog = catalogData.catalog || [];

        // クライアント・施策マップの生成
        clientProjectMap = {};
        allRecords.forEach(r => {
            // スプレッドシートからの入力揺れに対応
            const client = (r.client || '共通').toString().trim();
            const project = (r.project || '共通').toString().trim();

            if (!clientProjectMap[client]) {
                clientProjectMap[client] = new Set();
            }
            clientProjectMap[client].add(project);

            // フィルタ処理しやすいように上書き保存しておく
            r.client = client;
            r.project = project;
        });

        // 扱いやすいようにSetを配列に変換し、ソートなども可能に
        for (const client in clientProjectMap) {
            clientProjectMap[client] = Array.from(clientProjectMap[client]).sort();
        }

        return { records: allRecords, workflows, catalog, clientProjectMap };
    }

    function parseSheetData(data) {
        if (!data.values || data.values.length === 0) return [];
        // ヘッダー行の揺らぎ（大文字小文字・前後の空白）を吸収してすべて小文字にする
        const headers = data.values[0].map(h => (h || '').toString().trim().toLowerCase());
        const rows = data.values.slice(1);

        const arrayFields = ['channel', 'tags', 'required_info', 'workflow_ids'];
        const intFields = ['priority_in_workflow'];

        return rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                let val = row[index];
                if (val !== undefined && val !== '') {
                    if (arrayFields.includes(header)) {
                        obj[header] = val.split(',').map(s => s.trim()).filter(s => s);
                    } else if (intFields.includes(header)) {
                        obj[header] = parseInt(val, 10);
                    } else {
                        obj[header] = val;
                    }
                } else {
                    obj[header] = arrayFields.includes(header) ? [] : null;
                }
            });
            return obj;
        });
    }

    const DEFAULT_WORKFLOWS = [
        { "workflow_id": "refund", "workflow_name": "返品・返金対応", "description": "商品の返品受付から返金完了まで", "keywords": ["返品", "返金", "返送", "キャンセル返品", "返却", "返品したい", "返したい", "お返し"], "required_slots": ["商品名", "購入日", "注文番号", "チャネル"], "allowed_channels": ["電話", "チャット", "メール"], "risk_level": "Med", "escalation_to": "SV" },
        { "workflow_id": "cancel", "workflow_name": "解約・契約解除対応", "description": "契約の解約受付から完了通知まで", "keywords": ["解約", "契約解除", "退会", "キャンセル", "やめたい", "辞める", "停止", "止めたい"], "required_slots": ["会員番号", "契約種別", "解約希望日", "チャネル"], "allowed_channels": ["電話", "チャット"], "risk_level": "High", "escalation_to": "SV" },
        { "workflow_id": "address_change", "workflow_name": "住所変更対応", "description": "会員登録住所の変更手続き", "keywords": ["住所変更", "引っ越し", "引越し", "転居", "住所", "変更", "アドレス変更"], "required_slots": ["会員番号", "旧住所", "新住所"], "allowed_channels": ["電話", "チャット", "メール"], "risk_level": "Low", "escalation_to": "業務窓口" },
        { "workflow_id": "payment", "workflow_name": "請求・支払い対応", "description": "請求内容の確認・支払い方法変更・未払い対応", "keywords": ["請求", "支払い", "料金", "引き落とし", "未払い", "請求書", "クレジット", "振込", "決済"], "required_slots": ["会員番号", "対象月", "金額"], "allowed_channels": ["電話", "チャット"], "risk_level": "High", "escalation_to": "SV" },
        { "workflow_id": "product_inquiry", "workflow_name": "商品問い合わせ対応", "description": "商品仕様・在庫・価格・使い方に関する問い合わせ対応", "keywords": ["商品", "製品", "仕様", "在庫", "価格", "値段", "使い方", "使用方法", "説明", "詳細"], "required_slots": ["商品名"], "allowed_channels": ["電話", "チャット", "メール"], "risk_level": "Low", "escalation_to": "業務窓口" },
        { "workflow_id": "system_operation", "workflow_name": "システム操作サポート", "description": "会員サイト・アプリのログイン・操作方法に関するサポート", "keywords": ["ログイン", "パスワード", "アカウント", "会員サイト", "アプリ", "操作", "エラー", "不具合", "使えない"], "required_slots": ["会員番号", "利用端末", "エラー内容"], "allowed_channels": ["電話", "チャット"], "risk_level": "Low", "escalation_to": "システム部門" },
        { "workflow_id": "complaint", "workflow_name": "クレーム・苦情対応", "description": "商品不良・サービス品質に関するクレーム受付と初期対応", "keywords": ["クレーム", "苦情", "不満", "怒り", "ひどい", "最悪", "問題", "欠陥", "不良", "壊れ"], "required_slots": ["商品名", "発生日", "状況詳細"], "allowed_channels": ["電話"], "risk_level": "High", "escalation_to": "SV" },
        { "workflow_id": "exchange", "workflow_name": "交換・修理対応", "description": "商品の交換・修理受付から完了までの手順", "keywords": ["交換", "修理", "取り替え", "換えて", "直して", "壊れた", "故障"], "required_slots": ["商品名", "購入日", "不具合内容"], "allowed_channels": ["電話", "チャット"], "risk_level": "Med", "escalation_to": "業務窓口" }
    ];

    async function fetchJSON(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.warn(`Local fetch failed for ${url} (Could be due to running via file:// without web server):`, e);
            // ローカルファイルが読み取れない場合は空またはデフォルトのデータを返す
            if (url.includes('workflows.json')) return { workflows: DEFAULT_WORKFLOWS };
            if (url.includes('catalog.json')) return { catalog: [] };
            if (url.includes('manuals.json')) return { records: [] };
            if (url.includes('faq.json')) return { records: [] };
            return {};
        }
    }

    /** 有効日フィルタ: valid_from <= today <= valid_until (null=無期限) */
    function applyDateFilter(records, today) {
        return records.filter(r => {
            const from = r.valid_from || '0000-01-01';
            const until = r.valid_until || '9999-12-31';
            return from <= today && today <= until;
        });
    }

    /**
     * 版管理フィルタ: 同一conflict_groupのうち最大versionのレコードのみ残す
     * conflict_groupが未設定の場合はそのまま通す
     */
    function applyVersionFilter(records) {
        const groups = {};
        const noGroup = [];

        records.forEach(r => {
            if (!r.conflict_group) { noGroup.push(r); return; }
            const v = parseInt(r.version || '0', 10);
            if (!groups[r.conflict_group] || v > groups[r.conflict_group].v) {
                groups[r.conflict_group] = { r, v };
            }
        });

        return [...Object.values(groups).map(g => g.r), ...noGroup];
    }

    function getRecords() { return allRecords; }
    function getWorkflows() { return workflows; }
    function getCatalog() { return catalog; }
    function getClientProjectMap() { return clientProjectMap; }

    /** 権限フィルタ: 機密区分が「社内限」以上は管理者のみ */
    function filterByRole(records, user) {
        if (!user) return [];
        if (user.level >= 3) return records; // 管理者: 全件
        // オペレーター/SV: 「一般」のみ
        return records.filter(r => r.confidentiality === '一般');
    }

    return { loadAll, getRecords, getWorkflows, getCatalog, filterByRole, getClientProjectMap };
})();
