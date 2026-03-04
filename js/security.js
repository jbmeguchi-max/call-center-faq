/**
 * security.js - 管理者IPアドレス制限およびドメイン遮断ロジック
 *
 * IPアドレスの管理方法：
 *   - Googleスプレッドシートに「IP_Restriction」という名前のシートを作成し、
 *     A列（1行目はヘッダー「ip」）に許可IPを1つずつ入力してください。
 *   - シートが存在しない or 空の場合は全IPからアクセス可能（制限なし）です。
 *   - 管理画面のIPアドレス制限設定でも追加・削除できます（localStorageに一次保存）。
 */
window.Security = (() => {
    const OLD_DOMAIN = 'jbmeguchi-max.github.io';
    const NEW_ADMIN_URL = 'https://call-center-faq.vercel.app/admin.html';
    const LOCAL_STORAGE_KEY = 'ccfaq_allowed_ips';

    // スプレッドシートID・APIキー（dataLoader.jsと共有）
    const SPREADSHEET_ID = '1ohexVmYipYE5aAB8z-8PGVPgUz2QGvQ1lZj0vPbcHlE';
    const API_KEY = 'AIzaSyBHDYguaml7GIz_8TpGkaO1waymmvGyk-U';
    const IP_SHEET_NAME = 'IP_Restriction';

    /**
     * index.htmlからの互換性用エントリーポイント
     * isMainApp: true の場合はチャット画面向け（IP制限チェックのみ）
     */
    function init(options) {
        const isMainApp = options && options.isMainApp;
        if (location.hostname === OLD_DOMAIN && !isMainApp) {
            blockDomain();
        }
        // ページロード後に非同期でIP制限チェック
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => checkIpRestriction());
        } else {
            checkIpRestriction();
        }
    }

    /**
     * 同期チェック: 旧ドメインからのアクセスを即座に遮断
     */
    function initSync() {
        if (location.hostname === OLD_DOMAIN) {
            blockDomain();
        }
    }

    /**
     * スプレッドシートのIP_RestrictionシートからIPリストを取得
     */
    async function fetchIpsFromSheet() {
        try {
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(IP_SHEET_NAME)}?key=${API_KEY}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null; // シートが存在しない場合はnullを返す

            const data = await res.json();
            if (!data.values || data.values.length <= 1) return []; // ヘッダーのみ or 空

            // 1行目はヘッダー（ip）として扱い、2行目以降のA列を取得
            const ips = data.values.slice(1)
                .map(row => (row[0] || '').toString().trim())
                .filter(ip => ip.length > 0);
            return ips;
        } catch (e) {
            console.warn('IP_Restrictionシートの取得に失敗:', e);
            return null; // 取得失敗の場合はnullを返す
        }
    }

    /**
     * 非同期チェック: IPアドレス制限チェック（DOMロード後に呼ぶ）
     * スプレッドシートのIPリスト → LocalStorageのIPリストの順で確認
     */
    async function checkIpRestriction() {
        // まずスプレッドシートからIPリストを取得
        const sheetIPs = await fetchIpsFromSheet();

        // スプレッドシートIPリストがある場合はそれを優先、なければLocalStorageを使用
        let allowedIPs;
        if (sheetIPs !== null) {
            allowedIPs = sheetIPs;
            // スプレッドシートのリストをLocalStorageと同期
            if (sheetIPs.length > 0) {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sheetIPs));
            }
        } else {
            // スプレッドシート取得失敗時はLocalStorageにフォールバック
            allowedIPs = getAllowedIps();
        }

        if (allowedIPs.length === 0) return; // 制限なし

        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            const currentIP = data.ip;

            if (!allowedIPs.includes(currentIP)) {
                document.body.innerHTML = `
                    <div style="min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0f1117; color:#e8eaf6; font-family:'Noto Sans JP',sans-serif; text-align:center; padding:2rem;">
                        <div style="max-width:480px; width:100%;">
                            <div style="font-size:4rem; margin-bottom:1rem; line-height:1;">🚫</div>
                            <h1 style="font-size:1.6rem; font-weight:700; margin-bottom:0.5rem; color:#f05a5a;">アクセスが拒否されました</h1>
                            <p style="font-size:0.9rem; color:#9aa3c0; margin-bottom:2rem; line-height:1.6;">
                                このページは許可されたIPアドレスからのみアクセス可能です。<br>
                                管理者に問い合わせてIPアドレスの追加を依頼してください。
                            </p>

                            <div style="background:#1a2035; border:1px solid #2d3a5a; border-radius:10px; padding:1.25rem; margin-bottom:1.5rem; text-align:left;">
                                <div style="margin-bottom:0.75rem;">
                                    <span style="font-size:0.7rem; color:#6b7a99; font-weight:600; letter-spacing:0.05em; text-transform:uppercase;">あなたのIPアドレス</span>
                                    <div style="font-size:1.1rem; font-family:monospace; color:#f05a5a; font-weight:700; margin-top:0.2rem;">${currentIP}</div>
                                </div>
                                <div style="border-top:1px solid #2d3a5a; padding-top:0.75rem;">
                                    <span style="font-size:0.7rem; color:#6b7a99; font-weight:600; letter-spacing:0.05em; text-transform:uppercase;">制限ステータス</span>
                                    <div style="font-size:0.9rem; color:#f5a623; font-weight:700; margin-top:0.2rem;">🔒 IPアドレス制限が有効（${allowedIPs.length}件登録済み）</div>
                                </div>
                            </div>

                            <div style="background:rgba(79,142,247,0.08); border:1px solid rgba(79,142,247,0.2); border-radius:8px; padding:0.9rem 1.2rem; margin-bottom:1.5rem; text-align:left; font-size:0.8rem; color:#9aa3c0; line-height:1.7;">
                                <strong style="color:#e8eaf6;">📋 解除方法</strong><br>
                                管理者がGoogleスプレッドシートの「IP_Restriction」シートに<br>
                                上記のIPアドレスを追加してください。
                            </div>

                            <button onclick="location.href='index.html'" style="padding:0.8rem 2rem; background:#1e243a; color:#e8eaf6; border:1px solid #2d3a5a; border-radius:8px; cursor:pointer; font-size:0.9rem; font-weight:600;">← チャット画面へ戻る</button>
                        </div>
                    </div>
                `;
            }
        } catch (e) {
            console.warn('IP check failed, allowing access for safety:', e);
        }
    }

    function blockDomain() {
        document.body.innerHTML = `
            <div style="height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0f1117; color:#e8eaf6; font-family:sans-serif; text-align:center; padding:2rem;">
                <h1 style="font-size:2rem; margin-bottom:1rem;">⚠️ このURLは現在無効です</h1>
                <p style="font-size:1.1rem; color:#9aa3c0; margin-bottom:2rem;">セキュリティおよび機能アップデートのため、本システムはVercel版へ移行しました。</p>
                <a href="${NEW_ADMIN_URL}" style="padding:1rem 2rem; background:#4f8ef7; color:white; text-decoration:none; border-radius:8px; font-weight:bold;">Vercel版の管理者画面へ移動する</a>
            </div>
        `;
        throw new Error('Access from invalid domain blocked.');
    }

    function getAllowedIps() {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    }

    function saveAllowedIps(ips) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ips));
    }

    return { init, initSync, checkIpRestriction, getAllowedIps, saveAllowedIps, fetchIpsFromSheet };
})();
