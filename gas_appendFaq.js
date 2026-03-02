/**
 * Google Apps Script - FAQ自動追加用 Web API
 * 
 * このスクリプトをスプレッドシートのスクリプトエディタに貼り付けて
 * ウェブアプリとしてデプロイしてください。
 * 
 * 設定手順:
 * 1. スプレッドシートを開く
 * 2. メニュー「拡張機能」→「Apps Script」
 * 3. このコードを貼り付けて保存
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類:「ウェブアプリ」
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 5. デプロイ後に表示されるURLをコピー
 */

function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const rows = data.rows; // 2次元配列 [[val1, val2, ...], ...]

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return ContentService.createTextOutput(JSON.stringify({
                success: false,
                error: 'データが空です'
            })).setMimeType(ContentService.MimeType.JSON);
        }

        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
        const lastRow = sheet.getLastRow();

        // 最終行の次に追加
        sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);

        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            message: rows.length + '件を追加しました',
            range: 'A' + (lastRow + 1) + ':' + String.fromCharCode(64 + rows[0].length) + (lastRow + rows.length)
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({
            success: false,
            error: err.message
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

// テスト用: GETリクエストでヘルスチェック
function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        message: 'FAQ追加APIは正常に動作しています'
    })).setMimeType(ContentService.MimeType.JSON);
}
