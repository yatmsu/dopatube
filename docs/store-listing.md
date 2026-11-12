# Chrome Web Store listing copy

The localized listing name and short description come from `manifest.json` via `extensionName` and `extensionDescription` in `_locales/en/messages.json` and `_locales/ja/messages.json`. They take effect when an updated package is uploaded and published. The brand shown in the popup and on the playback controls remains DopaTube.

Detailed descriptions are managed separately in the Chrome Web Store Developer Dashboard. Select the listing language and replace its entire detailed description with the contents of the corresponding text block below. Do not copy the code fences, this document's headings, or the labels “Summary” and “Description” into that field. Editing this file does not update the published store listing.

## Japanese detailed description

```text
YouTube上部のボタンから、よく使う再生速度をワンクリックで切り替え。

DopaTubeは、YouTubeのロゴと検索ボックスの間に再生速度ボタンを追加するChrome拡張機能です。数字をクリックするだけで、設定した速度を順番に切り替えられます。

・初期設定は1.0倍 → 1.5倍 → 2.0倍。最後まで進むと最初の速度に戻ります。
・0.25〜4.0倍の範囲で、0.05倍刻みの速度を2〜5個設定できます。
・「ド」のロゴをクリックしたときの動作を、次の速度へ切り替える・1.0倍に戻す・何もしない、から選べます。
・YouTube標準の再生速度設定と相互に反映します。
・通常の動画、ライブ配信の録画、クリップ、Shorts、表示中のミニプレーヤーに対応します。プレビューの速度は変更しません。
・日本語と英語に対応します。未対応の言語環境では英語で表示します。

再生速度はタブごとに管理され、ページ内で動画を切り替えても維持されます。ページを再読み込みすると1.0倍に戻ります。速度ループとロゴの動作設定は端末内に保存され、ブラウザーを再起動しても維持されます。

個人情報や視聴履歴の収集・外部送信、アクセス解析は行いません。
YouTubeおよびGoogleの公式製品ではありません。
```

## English detailed description

```text
Switch between your favorite YouTube playback speeds with one click.

DopaTube adds a playback speed button between the YouTube logo and the search box. Click the number to cycle through your chosen speeds.

• Start with the default cycle: 1.0× → 1.5× → 2.0×, then back to the first speed.
• Choose 2–5 speeds from 0.25× to 4.0× in 0.05× increments.
• Set the “ド” logo to advance to the next speed, reset to 1.0×, or do nothing when clicked.
• Keep the button and YouTube’s built-in playback speed settings in sync in both directions.
• Control regular videos, live stream recordings, clips, Shorts, and the active miniplayer. Preview speeds are left unchanged.
• Use Japanese or English, following Chrome’s display language. Other language settings use English.

Each tab keeps its own playback speed when you switch videos within the page. Reloading the page resets it to 1.0×. Your speed cycle and logo preferences are saved on your device and retained across browser restarts.

No personal information or watch history is collected or sent to external servers. No analytics are used.
Not an official YouTube or Google product.
```
