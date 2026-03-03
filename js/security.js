/**
 * security.js - 管理者IPアドレス制限およびドメイン遮断ロジック
 */
window.Security = (() => {
    const STORAGE_KEY = 'ccfaq_allowed_ips';
    const OLD_DOMAIN = 'jbmeguchi-max.github.io';
    const NEW_ADMIN_URL = 'https://call-center-faq.vercel.app/admin.html';

    /**
     * 同期チェック: 旧ドメインからのアクセスを即座に遮断（スクリプトタグ内で呼ぶ）
     */
    function initSync() {
        if (location.hostname === OLD_DOMAIN) {
            blockDomain();
        }
    }

    /**
     * 非同期チェック: IPアドレス制限チェック（DOMロード後に呼ぶ）
     */
    async function checkIpRestriction() {
        const allowedIPs = getAllowedIps();
        if (allowedIPs.length === 0) return; // 制限なし

        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            const currentIP = data.ip;

            if (!allowedIPs.includes(currentIP)) {
                document.body.innerHTML = `
                    <div style="height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0f1117; color:#e8eaf6; font-family:sans-serif; text-align:center; padding:2rem;">
                        <h1 style="font-size:2rem; margin-bottom:1rem;">🚫 アクセス拒否</h1>
                        <p style="font-size:1.1rem; color:#9aa3c0; margin-bottom:1rem;">このページの閲覧は許可されたIPアドレスからのみ可能です。</p>
                        <p style="font-size:0.9rem; color:#f05a5a;">現在のIP: ${currentIP}</p>
                        <button onclick="location.href='index.html'" style="margin-top:2rem; padding:0.8rem 1.5rem; background:#1e243a; color:white; border:1px solid #2d3a5a; border-radius:8px; cursor:pointer;">チャット画面へ戻る</button>
                    </div>
                `;
            }
        } catch (e) {
            console.warn("IP check failed, allowing access for safety:", e);
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
        throw new Error("Access from invalid domain blocked.");
    }

    function getAllowedIps() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }

    function saveAllowedIps(ips) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ips));
    }

    return { initSync, checkIpRestriction, getAllowedIps, saveAllowedIps };
})();
