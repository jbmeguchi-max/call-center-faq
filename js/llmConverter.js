/**
 * llmConverter.js - 非構造化ドキュメントからのFAQ自動生成
 * 対応LLM: Gemini API / Groq API（モデル選択可能）
 * 
 * アーキテクチャ:
 *   ファイル → ブラウザ内でテキスト抽出 → テキストのみLLM APIへ送信 → FAQ JSON生成
 */
window.LlmConverter = (() => {
    let generatedFaqs = [];
    let selectedFile = null;

    // ===== API設定（固定キー）=====
    const PROVIDERS = {
        gemini: {
            name: 'Gemini 2.0 Flash',
            apiKey: 'AIzaSyARJgJ7B7AgSSeDDHNEGnghQOJ9slztikI',
            model: 'gemini-2.0-flash-lite'
        },
        groq: {
            name: 'Groq (Llama 3.3 70B)',
            apiKey: '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',
            model: 'llama-3.3-70b-versatile'
        }
    };

    let currentProvider = 'groq'; // デフォルトはGroq（Gemini Quota対策）

    // テキスト抽出後の最大文字数
    const MAX_TEXT_LENGTH = 30000;
    // リトライ設定
    const MAX_RETRIES = 3;
    const BASE_RETRY_DELAY_MS = 5000;

    async function init() {
        const btnRun = document.getElementById('btn-run-llm');
        const btnExport = document.getElementById('btn-llm-export-csv');
        const btnAppend = document.getElementById('btn-llm-append-sheet');
        const dropZone = document.getElementById('llm-drop-zone');
        const fileInput = document.getElementById('llm-file-input');
        const btnClear = document.getElementById('btn-clear-file');
        const providerSelect = document.getElementById('llm-provider-select');

        if (!btnRun || !btnExport || !dropZone) return;

        // プロバイダー選択
        if (providerSelect) {
            providerSelect.value = currentProvider;
            providerSelect.addEventListener('change', (e) => {
                currentProvider = e.target.value;
                updateProviderStatus();
            });
            updateProviderStatus();
        }

        // イベントリスナー
        btnRun.addEventListener('click', handleRunLLM);
        if (btnAppend) btnAppend.addEventListener('click', handleAppendToSheet);
        btnExport.addEventListener('click', handleExportCSV);

        // D&Dイベント
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleFileSelect(e.target.files[0]);
            }
        });
        btnClear.addEventListener('click', clearFile);
    }

    function updateProviderStatus() {
        const statusEl = document.getElementById('api-key-status');
        if (statusEl) {
            const p = PROVIDERS[currentProvider];
            statusEl.textContent = `🔒 ${p.name} (${p.model})`;
            statusEl.style.color = 'var(--accent)';
        }
    }

    function handleFileSelect(file) {
        const dropZone = document.getElementById('llm-drop-zone');
        const fileInfo = document.getElementById('llm-file-info');
        const fileNameEl = document.getElementById('llm-file-name');

        selectedFile = file;
        fileNameEl.textContent = file.name;
        dropZone.style.display = 'none';
        fileInfo.style.display = 'flex';

        document.getElementById('llm-file-status').textContent = `📁 準備完了 (${(file.size / 1024).toFixed(1)} KB) - 実行ボタンを押してください`;
    }

    function clearFile(e) {
        if (e) e.stopPropagation();
        document.getElementById('llm-file-input').value = '';
        document.getElementById('llm-drop-zone').style.display = 'flex';
        document.getElementById('llm-file-info').style.display = 'none';
        document.getElementById('llm-source-text').value = '';
        document.getElementById('llm-file-name').textContent = '';
        selectedFile = null;
    }

    // ================================================================
    // テキスト抽出: ファイル形式ごとにブラウザ内でテキストを取り出す
    // ================================================================

    async function extractTextFromFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();

        switch (ext) {
            case 'txt':
            case 'csv':
            case 'md':
                return await readAsText(file);
            case 'pptx':
                return await extractTextFromPptx(file);
            case 'docx':
                return await extractTextFromDocx(file);
            case 'xlsx':
                return await extractTextFromXlsx(file);
            case 'pdf':
                return await extractTextFromPdf(file);
            default:
                try {
                    return await readAsText(file);
                } catch {
                    throw new Error(`未対応のファイル形式です: .${ext}\n対応形式: .pptx, .docx, .xlsx, .pdf, .txt, .csv, .md`);
                }
        }
    }

    function readAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    function readAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
            reader.readAsArrayBuffer(file);
        });
    }

    // PPTX: ZIPを展開して各スライドのXMLからテキストを抽出
    async function extractTextFromPptx(file) {
        const arrayBuffer = await readAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(arrayBuffer);
        const texts = [];

        const slideFiles = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const numA = parseInt(a.match(/slide(\d+)/)[1]);
                const numB = parseInt(b.match(/slide(\d+)/)[1]);
                return numA - numB;
            });

        for (const slideName of slideFiles) {
            const xml = await zip.files[slideName].async('text');
            const slideNum = slideName.match(/slide(\d+)/)[1];
            const text = extractTextFromXml(xml);
            if (text.trim()) {
                texts.push(`--- スライド ${slideNum} ---\n${text}`);
            }
        }

        if (texts.length === 0) {
            throw new Error('PPTXファイルからテキストを抽出できませんでした。画像のみの可能性があります。');
        }
        return texts.join('\n\n');
    }

    // DOCX: ZIPを展開して document.xml からテキストを抽出
    async function extractTextFromDocx(file) {
        const arrayBuffer = await readAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(arrayBuffer);
        const docFile = zip.files['word/document.xml'];
        if (!docFile) throw new Error('DOCXファイルの構造が不正です。');
        const xml = await docFile.async('text');
        const text = extractTextFromXml(xml);
        if (!text.trim()) throw new Error('DOCXファイルからテキストを抽出できませんでした。');
        return text;
    }

    // XLSX: ZIPを展開して sharedStrings.xml と各シートからテキストを抽出
    async function extractTextFromXlsx(file) {
        const arrayBuffer = await readAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(arrayBuffer);
        const texts = [];

        const sharedStrings = [];
        const ssFile = zip.files['xl/sharedStrings.xml'];
        if (ssFile) {
            const ssXml = await ssFile.async('text');
            const parser = new DOMParser();
            const ssDoc = parser.parseFromString(ssXml, 'application/xml');
            const siElements = ssDoc.getElementsByTagName('si');
            for (let i = 0; i < siElements.length; i++) {
                sharedStrings.push(siElements[i].textContent || '');
            }
        }

        const sheetFiles = Object.keys(zip.files)
            .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
            .sort();

        for (let idx = 0; idx < sheetFiles.length; idx++) {
            const sheetXml = await zip.files[sheetFiles[idx]].async('text');
            const parser = new DOMParser();
            const doc = parser.parseFromString(sheetXml, 'application/xml');
            const rows = doc.getElementsByTagName('row');
            const rowTexts = [];

            for (let r = 0; r < rows.length; r++) {
                const cells = rows[r].getElementsByTagName('c');
                const cellValues = [];
                for (let c = 0; c < cells.length; c++) {
                    const cell = cells[c];
                    const type = cell.getAttribute('t');
                    const vEl = cell.getElementsByTagName('v')[0];
                    if (vEl) {
                        if (type === 's') {
                            const ssIdx = parseInt(vEl.textContent);
                            cellValues.push(sharedStrings[ssIdx] || '');
                        } else {
                            cellValues.push(vEl.textContent || '');
                        }
                    }
                }
                if (cellValues.some(v => v.trim())) {
                    rowTexts.push(cellValues.join('\t'));
                }
            }

            if (rowTexts.length > 0) {
                texts.push(`--- シート ${idx + 1} ---\n${rowTexts.join('\n')}`);
            }
        }

        if (texts.length === 0) throw new Error('XLSXファイルからテキストを抽出できませんでした。');
        return texts.join('\n\n');
    }

    // PDF: pdf.js を使ってテキストを抽出
    async function extractTextFromPdf(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF処理ライブラリが読み込まれていません。ページを再読み込みしてください。');
        }
        const arrayBuffer = await readAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const texts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            if (pageText.trim()) {
                texts.push(`--- ページ ${i} ---\n${pageText}`);
            }
        }
        if (texts.length === 0) throw new Error('PDFからテキストを抽出できませんでした。スキャン画像のPDFの場合OCRが必要です。');
        return texts.join('\n\n');
    }

    // XML内の全テキストノードを抽出するヘルパー
    function extractTextFromXml(xmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'application/xml');
        const paragraphs = [];

        // a:p (PowerPoint段落) → a:t
        const pElements = doc.getElementsByTagName('a:p');
        for (let i = 0; i < pElements.length; i++) {
            const tElements = pElements[i].getElementsByTagName('a:t');
            const texts = [];
            for (let j = 0; j < tElements.length; j++) texts.push(tElements[j].textContent);
            const line = texts.join('');
            if (line.trim()) paragraphs.push(line);
        }

        // w:p (Word段落) → w:t
        if (paragraphs.length === 0) {
            const wPElements = doc.getElementsByTagName('w:p');
            for (let i = 0; i < wPElements.length; i++) {
                const tEls = wPElements[i].getElementsByTagName('w:t');
                const texts = [];
                for (let j = 0; j < tEls.length; j++) texts.push(tEls[j].textContent);
                const line = texts.join('');
                if (line.trim()) paragraphs.push(line);
            }
        }

        // フォールバック
        if (paragraphs.length === 0) {
            const textElements = doc.getElementsByTagName('a:t');
            for (let i = 0; i < textElements.length; i++) {
                const t = textElements[i].textContent;
                if (t && t.trim()) paragraphs.push(t);
            }
        }

        return paragraphs.join('\n');
    }

    // ================================================================
    // メイン処理
    // ================================================================

    async function handleRunLLM() {
        const sourceText = document.getElementById('llm-source-text').value.trim();
        const clientName = document.getElementById('llm-client-name').value.trim();
        const projectName = document.getElementById('llm-project-name').value.trim();
        const categoryName = document.getElementById('llm-category-name').value.trim();
        const statusMsg = document.getElementById('llm-status-msg');
        const btnRun = document.getElementById('btn-run-llm');

        if (!selectedFile && !sourceText) {
            alert('対象のファイルをドラッグ＆ドロップするか、テキストを入力してください。');
            return;
        }

        if (!clientName) {
            alert('クライアント名を入力してください。');
            document.getElementById('llm-client-name').focus();
            return;
        }
        if (!projectName) {
            alert('施策・案件名を入力してください。');
            document.getElementById('llm-project-name').focus();
            return;
        }
        if (!categoryName) {
            alert('大カテゴリを入力してください。');
            document.getElementById('llm-category-name').focus();
            return;
        }

        statusMsg.textContent = '生成準備中...';
        statusMsg.style.color = '#4f8ef7';
        btnRun.disabled = true;
        btnRun.querySelector('span').textContent = '⏳ AI処理中...';

        try {
            let extractedText = sourceText || '';

            // 1. ファイルからテキストを抽出（ブラウザ内処理）
            if (selectedFile) {
                statusMsg.textContent = '1/2: ファイルからテキストを抽出中...';
                extractedText = await extractTextFromFile(selectedFile);

                const originalLength = extractedText.length;
                if (originalLength > MAX_TEXT_LENGTH) {
                    extractedText = extractedText.substring(0, MAX_TEXT_LENGTH);
                    statusMsg.textContent = `1/2: テキスト抽出完了（${originalLength.toLocaleString()}文字 → ${MAX_TEXT_LENGTH.toLocaleString()}文字に切り詰め）`;
                } else {
                    statusMsg.textContent = `1/2: テキスト抽出完了（${originalLength.toLocaleString()}文字）`;
                }
                document.getElementById('llm-source-text').value = extractedText;
            }

            if (!extractedText.trim()) {
                throw new Error('テキストの抽出結果が空です。別のファイルをお試しください。');
            }

            // 2. FAQ生成（選択されたプロバイダーで実行）
            const providerInfo = PROVIDERS[currentProvider];
            statusMsg.textContent = `2/2: ${providerInfo.name} でFAQ生成中...`;
            const rawOutput = await callLLMWithRetry(extractedText, statusMsg);

            // JSONパース
            const jsonString = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
            let parsedArr = [];
            try {
                parsedArr = JSON.parse(jsonString);
            } catch (pErr) {
                console.error('JSON parse error:', pErr, jsonString);
                throw new Error('AIの出力が正しいJSON形式ではありませんでした。もう一度実行してください。');
            }

            if (!Array.isArray(parsedArr)) throw new Error('AIが想定外の出力をしました。');

            generatedFaqs = parsedArr.map((item, idx) => ({
                id: idx + 1,
                title: String(item.title || '無題'),
                question: String(item.question || ''),
                answer: String(item.answer || ''),
                client: clientName,
                project: projectName,
                category: categoryName
            }));

            renderPreview();
            statusMsg.textContent = `✅ 成功: ${generatedFaqs.length}件のFAQが生成されました（${providerInfo.name}）`;
            statusMsg.style.color = '#2dd4a0';
            document.getElementById('btn-llm-export-csv').disabled = false;
            const btnAppend = document.getElementById('btn-llm-append-sheet');
            if (btnAppend) btnAppend.disabled = false;

        } catch (error) {
            console.error('LLM Converter Error:', error);
            statusMsg.textContent = '❌ エラー: ' + error.message;
            statusMsg.style.color = '#f05a5a';
        } finally {
            btnRun.disabled = false;
            btnRun.querySelector('span').textContent = '✨ AIを使ってプレビューを生成';
        }
    }

    // ================================================================
    // LLM API呼び出し（リトライ機能付き）
    // ================================================================

    async function callLLMWithRetry(text, statusMsg) {
        // ステップ1: 現在のプロバイダー（デフォルト: Groq）で試す
        const primaryProvider = currentProvider;
        const fallbackProvider = primaryProvider === 'groq' ? 'gemini' : 'groq';

        try {
            return await callProviderWithRetry(primaryProvider, text, statusMsg);
        } catch (primaryError) {
            // Quota/レート制限エラーの場合、フォールバックプロバイダーへ自動切替
            const isQuotaError = primaryError.message.includes('429') ||
                primaryError.message.includes('503') ||
                primaryError.message.includes('quota') ||
                primaryError.message.includes('rate');

            if (isQuotaError) {
                const fb = PROVIDERS[fallbackProvider];
                statusMsg.textContent = `⚠️ ${PROVIDERS[primaryProvider].name} がAPI制限中... ${fb.name} に自動切替します`;
                statusMsg.style.color = '#f5a623';
                await sleep(1000);

                // UIのプルダウンも反映
                currentProvider = fallbackProvider;
                const selectEl = document.getElementById('llm-provider-select');
                if (selectEl) selectEl.value = fallbackProvider;
                updateProviderStatus();

                try {
                    return await callProviderWithRetry(fallbackProvider, text, statusMsg);
                } catch (fallbackError) {
                    throw new Error(`両方のAI（${PROVIDERS[primaryProvider].name} / ${fb.name}）でエラーが発生しました。\n` +
                        `1つ目: ${primaryError.message}\n2つ目: ${fallbackError.message}`);
                }
            }
            throw primaryError;
        }
    }

    async function callProviderWithRetry(provider, text, statusMsg) {
        let lastError = null;
        const maxRetries = 2; // 各プロバイダーは最大2回試行

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                statusMsg.textContent = `2/2: ${PROVIDERS[provider].name} でFAQ生成中...`;
                statusMsg.style.color = '#4f8ef7';

                if (provider === 'gemini') {
                    return await callGeminiAPI(text);
                } else {
                    return await callGroqAPI(text);
                }
            } catch (error) {
                lastError = error;
                const isRetryable = error.message.includes('429') || error.message.includes('503');
                if (isRetryable && attempt < maxRetries - 1) {
                    const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    const delaySec = Math.round(delayMs / 1000);
                    statusMsg.textContent = `⏳ ${PROVIDERS[provider].name} API制限... ${delaySec}秒後にリトライ`;
                    statusMsg.style.color = '#f5a623';
                    await sleep(delayMs);
                } else {
                    throw error;
                }
            }
        }
        throw lastError;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== FAQ生成用プロンプト =====
    const SYSTEM_PROMPT = `あなたはコールセンター向けの業務ドキュメント専門のFAQアシスタントです。
提供されたドキュメントのテキストから、カスタマーサポートや現場のスタッフが抱くであろう「想定される質問(question)」と、それに対するマニュアル内の「適切な回答(answer)」のペアを可能な限り抽出・生成してください。
また各ペアに対して、一言で内容がわかる短い「見出し(title)」を必ず付与してください。
結果は必ず以下のフォーマットに従う純粋な【JSON配列のみ】を出力してください。Markdown修飾や説明文、前置きは一切含めないでください。

[出力フォーマット例]
[
  { "title": "商品の返品可否", "question": "購入した商品は返品できますか？", "answer": "未開封であれば商品到着後8日以内は可能です。" }
]`;

    // ===== Gemini API =====
    async function callGeminiAPI(inputText) {
        const provider = PROVIDERS.gemini;
        const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`;

        const payload = {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
                parts: [
                    { text: inputText },
                    { text: "上記のドキュメントの内容からFAQを抽出してください。" }
                ]
            }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json"
            }
        };

        const res = await fetch(generateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Gemini API エラー (${res.status}): ${err}`);
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    }

    // ===== Groq API (OpenAI互換) =====
    async function callGroqAPI(inputText) {
        const provider = PROVIDERS.groq;
        const generateUrl = 'https://api.groq.com/openai/v1/chat/completions';

        const payload = {
            model: provider.model,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: inputText + '\n\n上記のドキュメントの内容からFAQを抽出してください。' }
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' }
        };

        const res = await fetch(generateUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Groq API エラー (${res.status}): ${err}`);
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '[]';

        // Groqはresponse_format: json_objectでもラッパーオブジェクト{"faqs":[...]}を返す場合がある
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) return content;
            // オブジェクトの場合、配列を持つプロパティを探す
            for (const key of Object.keys(parsed)) {
                if (Array.isArray(parsed[key])) {
                    return JSON.stringify(parsed[key]);
                }
            }
            return content;
        } catch {
            return content;
        }
    }

    // ================================================================
    // スプレッドシート自動追加（Google Apps Script 経由）
    // ================================================================

    // dataLoader.js と同じスプレッドシート設定を参照（読み取り用）
    const SPREADSHEET_ID = '1ohexVmYipYE5aAB8z-8PGVPgUz2QGvQ1lZj0vPbcHlE';
    const SHEETS_API_KEY = 'AIzaSyBHDYguaml7GIz_8TpGkaO1waymmvGyk-U';

    // Apps Script Web App URL（デプロイ後にユーザーが設定）
    let gasWebAppUrl = localStorage.getItem('cc_faq_gas_url') || '';

    async function handleAppendToSheet() {
        if (!generatedFaqs.length) return;

        // Apps Script URLが未設定の場合
        if (!gasWebAppUrl) {
            const url = prompt(
                'Google Apps Script のデプロイURLを入力してください。\n\n' +
                '設定手順:\n' +
                '1. スプレッドシートを開く → 拡張機能 → Apps Script\n' +
                '2. gas_appendFaq.js の内容を貼り付けて保存\n' +
                '3. デプロイ → 新しいデプロイ → ウェブアプリ\n' +
                '4. 実行ユーザー:自分 / アクセス:全員 → デプロイ\n' +
                '5. 表示されたURLをここに貼り付け'
            );
            if (!url || !url.startsWith('https://script.google.com/')) {
                alert('正しいApps Script URLを入力してください。\nhttps://script.google.com/ で始まるURLです。');
                return;
            }
            gasWebAppUrl = url.trim();
            localStorage.setItem('cc_faq_gas_url', gasWebAppUrl);
        }

        const statusEl = document.getElementById('llm-sheet-status');
        const btnAppend = document.getElementById('btn-llm-append-sheet');
        btnAppend.disabled = true;
        btnAppend.textContent = '⏳ 追加中...';
        statusEl.textContent = 'スプレッドシートに接続中...';
        statusEl.style.color = '#4f8ef7';

        try {
            // 1. ヘッダー行を読み取り（Google Sheets API - 読み取りはAPIキーでOK）
            const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${SHEETS_API_KEY}&fields=sheets.properties`;
            const metaRes = await fetch(metaUrl);
            if (!metaRes.ok) throw new Error(`シート情報取得失敗 (${metaRes.status})`);
            const metaData = await metaRes.json();
            const sheetName = metaData.sheets?.[0]?.properties?.title || 'FAQ';

            const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!1:1')}?key=${SHEETS_API_KEY}`;
            const headerRes = await fetch(headerUrl);
            if (!headerRes.ok) throw new Error(`ヘッダー取得失敗 (${headerRes.status})`);
            const headerData = await headerRes.json();
            const headers = (headerData.values?.[0] || []).map(h => h.toString().trim().toLowerCase());

            if (headers.length === 0) throw new Error('スプレッドシートにヘッダー行がありません。');

            // 2. 既存データからID列の最大値を取得して連番を計算
            const allDataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A:A')}?key=${SHEETS_API_KEY}`;
            const allDataRes = await fetch(allDataUrl);
            let nextId = 1;
            if (allDataRes.ok) {
                const allData = await allDataRes.json();
                const existingIds = (allData.values || []).slice(1) // ヘッダー除外
                    .map(row => parseInt(row[0], 10))
                    .filter(n => !isNaN(n));
                if (existingIds.length > 0) {
                    nextId = Math.max(...existingIds) + 1;
                }
            }

            // 3. FAQデータをヘッダー順に変換（IDを連番で付与）
            const rows = generatedFaqs.map((f, idx) => {
                const rowData = {
                    id: nextId + idx,
                    client: f.client || '',
                    project: f.project || '',
                    category: f.category || '',
                    title: f.title,
                    question: f.question,
                    answer: f.answer,
                    search_keywords: '',
                    workflow_ids: 'common_flow',
                    step_phase: '業務全般',
                    version: '1.0',
                    valid_from: new Date().toISOString().split('T')[0],
                    valid_to: '2099-12-31',
                    confidentiality: '一般',
                    access_level: '0',
                    url_ref: '',
                    file_doc: ''
                };
                return headers.map(h => rowData[h] !== undefined ? rowData[h] : '');
            });

            // 3. Apps Script Web App にPOST
            statusEl.textContent = `${generatedFaqs.length}件をスプレッドシートに書き込み中...`;

            const appendRes = await fetch(gasWebAppUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ rows: rows }),
                mode: 'no-cors'
            });

            // no-corsモードではレスポンスが読めないため、成功したものとして扱う
            // （Apps Script側でエラーがあった場合はスプレッドシートに追加されない）
            statusEl.innerHTML = `✅ <strong>${generatedFaqs.length}件</strong>のFAQをスプレッドシートに送信しました。<br><span style="font-size:0.75rem; color:var(--text-muted)">スプレッドシートを開いて追加されたことを確認してください。反映されない場合はApps Script URLの設定を確認してください。</span>`;
            statusEl.style.color = '#2dd4a0';

        } catch (error) {
            console.error('Spreadsheet append error:', error);
            statusEl.innerHTML = `❌ スプレッドシート追加エラー: ${error.message}<br><span style="font-size:0.75rem; color:var(--text-muted)">CSVエクスポートを使って手動で追加してください。</span>`;
            statusEl.style.color = '#f05a5a';
        } finally {
            btnAppend.disabled = false;
            btnAppend.textContent = '📤 スプレッドシートに自動追加';
        }
    }

    // ================================================================
    // プレビュー表示 & CSV出力
    // ================================================================

    function renderPreview() {
        const tbody = document.getElementById('llm-preview-tbody');
        if (!generatedFaqs.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">まだ生成されていません</td></tr>';
            return;
        }

        tbody.innerHTML = generatedFaqs.map((f, i) => `
            <tr>
                <td style="font-size:0.7rem; color:var(--text-muted)">${f.id}</td>
                <td class="truncate" style="max-width:120px;" title="${f.title.replace(/"/g, '&quot;')}"><strong>${f.title}</strong></td>
                <td class="truncate" style="max-width:200px;" title="${f.question.replace(/"/g, '&quot;')}">${f.question}</td>
                <td class="truncate" style="max-width:200px;" title="${f.answer.replace(/"/g, '&quot;')}">${f.answer}</td>
                <td><span class="badge-pill pill-escalated">${f.client || '共通'}</span></td>
                <td><span class="badge-pill pill-found">${f.project || '共通'}</span></td>
                <td>${f.category || '-'}</td>
                <td><button onclick="LlmConverter.removeRow(${i})" class="btn-danger" style="padding:0.2rem 0.5rem; font-size:0.75rem;">🗑️</button></td>
            </tr>
        `).join('');
    }

    function removeRow(index) {
        generatedFaqs.splice(index, 1);
        renderPreview();
        if (generatedFaqs.length === 0) {
            document.getElementById('btn-llm-export-csv').disabled = true;
            const btnAppend = document.getElementById('btn-llm-append-sheet');
            if (btnAppend) btnAppend.disabled = true;
        }
    }

    function escapeCSV(val) {
        if (val === null || val === undefined) return '';
        const s = String(val);
        return '"' + s.replace(/"/g, '""') + '"';
    }

    function handleExportCSV() {
        if (!generatedFaqs.length) return;

        const cols = [
            'id', 'client', 'project', 'category', 'title', 'question', 'answer',
            'search_keywords', 'workflow_ids', 'step_phase', 'version',
            'valid_from', 'valid_to', 'confidentiality', 'access_level', 'url_ref', 'file_doc'
        ];

        const header = cols.join(',');
        const rows = generatedFaqs.map(f => {
            const rowData = {
                id: f.id, client: f.client, project: f.project, category: f.category,
                title: f.title, question: f.question, answer: f.answer,
                search_keywords: '', workflow_ids: 'common_flow', step_phase: '業務全般',
                version: '1.0', valid_from: new Date().toISOString().split('T')[0],
                valid_to: '2099-12-31', confidentiality: '一般', access_level: '0',
                url_ref: '', file_doc: ''
            };
            return cols.map(c => escapeCSV(rowData[c])).join(',');
        });

        const csv = '\uFEFF' + [header, ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `faq_ai_import_${ts}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    document.addEventListener('DOMContentLoaded', init);

    return { removeRow };
})();
