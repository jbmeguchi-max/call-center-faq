/**
 * auth.js - ロール管理（オペレーター/SV/管理者）
 */
window.Auth = (() => {
    const ROLES = {
        operator: { label: 'オペレーター', level: 1 },
        sv: { label: 'SV', level: 2 },
        admin: { label: '管理者', level: 3 }
    };

    // デモ用パスワード（実運用では環境変数または外部認証に置き換え）
    const CREDENTIALS = {
        operator: 'op1234',
        sv: 'sv5678',
        admin: 'admin9999'
    };

    let currentUser = null;

    function login(role, password) {
        if (!CREDENTIALS[role]) return { ok: false, error: '存在しないロールです' };
        if (CREDENTIALS[role] !== password) return { ok: false, error: 'パスワードが正しくありません' };
        currentUser = { role, label: ROLES[role].label, level: ROLES[role].level };
        sessionStorage.setItem('cc_user_session', JSON.stringify(currentUser));
        return { ok: true, user: currentUser };
    }

    function logout() {
        currentUser = null;
        sessionStorage.removeItem('cc_user_session');
    }

    function restore() {
        const stored = sessionStorage.getItem('cc_user_session');
        if (stored) {
            try {
                currentUser = JSON.parse(stored);
                return true;
            } catch (e) {
                console.error("Failed to parse stored session", e);
            }
        }
        return false;
    }

    function getUser() { return currentUser; }

    function isLoggedIn() { return currentUser !== null; }

    function hasLevel(minLevel) {
        if (!currentUser) return false;
        return currentUser.level >= minLevel;
    }

    function canAccessAdmin() { return hasLevel(3); }
    function canViewEscalations() { return hasLevel(2); }
    function canViewConfidential() { return hasLevel(3); }

    return { login, logout, restore, getUser, isLoggedIn, hasLevel, canAccessAdmin, canViewEscalations, canViewConfidential, ROLES };
})();
