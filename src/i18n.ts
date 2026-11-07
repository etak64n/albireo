// The words of the browser app in each language that a person can choose on the account
// page. English comes first, and its shape is the type of every language, so a word that
// another language misses stops the build. Words with values in them are functions.
//
// Components read the words with useT(). Code outside components, such as the API client
// and the upload, reads them with currentMessages() at the moment that it needs them.

import { useSyncExternalStore } from "react";
import type { Language } from "../shared/api.ts";

const en = {
  common: {
    cancel: "Cancel",
    save: "Save",
    saving: "Saving...",
    edit: "Edit",
    remove: "Remove",
    delete: "Delete",
    /** For screen readers while a part of the page loads. */
    loading: "Loading",
    loadMore: "Load more",
    loadingMore: "Loading...",
    title: "Title",
    description: "Description",
    series: "Series",
    videos: "Videos",
    allVideos: "All videos",
    channelSettings: "Channel settings",
    account: "Account",
    uploadedBy: "Uploaded by",
    date: "Date",
    length: "Length",
    breadcrumb: "Breadcrumb",
    reload: "Reload",
  },
  shell: {
    skipToContent: "Skip to content",
    menu: "Menu",
    openMenu: "Open the menu",
    closeMenu: "Close the menu",
    search: "Search",
    searchVideos: "Search videos",
    accountOf: (name: string) => `Account of ${name}`,
    yourChannel: "Your channel",
    logOut: "Log out",
    library: "Library",
    home: "Home",
    history: "History",
    newSeries: "New series",
    seriesTitle: "Series title",
    create: "Create",
    creating: "Creating...",
  },
  upload: {
    upload: "Upload",
    dismiss: "Dismiss",
    reading: "Reading the video...",
    finishing: "Finishing the upload...",
    progress: (percent: number, uploaded: string, total: string) => `Uploading ${percent}% (${uploaded} of ${total})`,
    dropToUpload: "Drop to upload",
    dropVideo: "Please drop a video file.",
    notVideo: "Choose a video file. The browser does not recognize this file as a video.",
    noPartUrl: (part: number) => `The API returned no URL for part ${part}.`,
    etagHidden: "The storage service hides the ETag header. Add ETag to ExposeHeaders in the bucket's CORS rules.",
    rejected: (status: number) => `The storage service rejected the upload with HTTP ${status}.`,
    failed: "The upload failed. Check the network and the bucket's CORS rules.",
  },
  api: {
    unreachable: "albireo could not be reached. If your sign-in expired, reload the page.",
    failed: (status: number) => `The request failed with HTTP ${status}.`,
  },
  files: {
    storageAnswered: (status: number) => `The storage service answered HTTP ${status}.`,
    unreadable: "The file could not be read. Check the network and the bucket's CORS rules.",
    pdfFailed: (reason: string) => `The PDF could not be opened: ${reason}`,
  },
  home: {
    recommended: "Recommended",
    play: "Play",
  },
  search: {
    title: "Search",
    resultsFor: (query: string) => `Results for “${query}”`,
  },
  notFound: {
    title: "Not found",
    message: "This page does not exist.",
    back: "Back to the library",
  },
  video: {
    details: "Details",
    resolution: "Resolution",
    rating: "Rating",
    episode: (episode: number) => `Episode ${episode}`,
    previous: "Previous",
    next: "Next",
    previousEpisode: (title: string) => `Previous: ${title}`,
    nextEpisode: (title: string) => `Next: ${title}`,
    noSeries: "No series",
  },
  rating: {
    yourRating: "Your rating",
    stars: (stars: number) => (stars === 1 ? "1 star" : `${stars} stars`),
    clear: "Clear",
  },
  comments: {
    comments: "Comments",
    placeholder: "Add a comment",
    comment: "Comment",
    posting: "Posting...",
    deleteQuestion: "Delete this comment?",
    deleteComment: "Delete the comment",
    playFrom: (time: string) => `Play from ${time}`,
  },
  attachments: {
    attachments: "Attachments",
    attach: "Attach",
    tooLarge: (size: string) => `Attachments can be at most ${size}.`,
    uploading: (fileName: string, percent: number) => `Uploading ${fileName} ${percent}%`,
    preview: "Preview",
    download: "Download",
    closePreview: "Close the preview",
    removeFile: (fileName: string) => `Remove ${fileName}`,
    removeQuestion: "Remove this attachment?",
  },
  series: {
    episodes: "Episodes",
    episode: "Episode",
    actions: "Actions",
    actionsFor: (title: string) => `Actions for ${title}`,
    moveEarlier: "Move earlier",
    moveLater: "Move later",
    removeFromSeries: "Remove from the series",
  },
  account: {
    details: "Details",
    email: "Email",
    role: "Role",
    admin: "Admin",
    member: "Member",
    joined: "Joined",
    preferences: "Preferences",
    language: "Language",
    signIn: "Sign-in",
    loginMethod: "Login method",
    signedIn: "Signed in",
    passkey: "Passkey",
    oneTimePin: "One-time PIN",
    passkeys: "Passkeys",
    name: "Name",
    added: "Added",
    lastUsed: "Last used",
    sessions: "Sessions",
    logOutOfThisDevice: "Log out of this device",
    device: "Device",
    location: "Location",
    lastActive: "Last active",
    thisDevice: "This device",
    /** "Chrome on macOS" */
    deviceName: (browser: string, os: string) => `${browser} on ${os}`,
    unknownDevice: "Unknown device",
    /** "Tokyo, Japan". Either part may be "". */
    place: (city: string, country: string) => [city, country].filter((part) => part !== "").join(", "),
  },
  channel: {
    picture: "Picture",
    changePicture: "Change picture",
    displayName: "Display name",
    bio: "Bio",
    saved: "Saved.",
    zoom: "Zoom",
    apply: "Apply",
    notPicture: "Choose a picture, such as a JPEG, PNG, or WebP image.",
    uploadFailed: "The picture could not be uploaded to the storage service.",
    unreadable: "The browser cannot read this file as a picture. Choose a JPEG, PNG, or WebP image.",
    cannotDraw: "The browser cannot draw the picture.",
    cannotEncode: "The browser cannot make a JPEG of the picture.",
  },
};

/** The words of the app in one language. */
export type Messages = typeof en;

const ja: Messages = {
  common: {
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中…",
    edit: "編集",
    remove: "削除",
    delete: "削除",
    loading: "読み込み中",
    loadMore: "さらに表示",
    loadingMore: "読み込み中…",
    title: "タイトル",
    description: "説明",
    series: "シリーズ",
    videos: "動画",
    allVideos: "すべての動画",
    channelSettings: "チャンネルの設定",
    account: "アカウント",
    uploadedBy: "投稿者",
    date: "投稿日",
    length: "長さ",
    breadcrumb: "パンくずリスト",
    reload: "再読み込み",
  },
  shell: {
    skipToContent: "本文へスキップ",
    menu: "メニュー",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
    search: "検索",
    searchVideos: "動画を検索",
    accountOf: (name) => `${name} のアカウント`,
    yourChannel: "自分のチャンネル",
    logOut: "ログアウト",
    library: "ライブラリ",
    home: "ホーム",
    history: "履歴",
    newSeries: "新しいシリーズ",
    seriesTitle: "シリーズのタイトル",
    create: "作成",
    creating: "作成中…",
  },
  upload: {
    upload: "アップロード",
    dismiss: "閉じる",
    reading: "動画を読み込んでいます…",
    finishing: "アップロードを仕上げています…",
    progress: (percent, uploaded, total) => `アップロード中 ${percent}%（${uploaded} / ${total}）`,
    dropToUpload: "ドロップしてアップロード",
    dropVideo: "動画ファイルをドロップしてください。",
    notVideo: "動画ファイルを選んでください。ブラウザはこのファイルを動画として認識できません。",
    noPartUrl: (part) => `API がパート ${part} の URL を返しませんでした。`,
    etagHidden: "ストレージサービスが ETag ヘッダーを隠しています。バケットの CORS ルールで ExposeHeaders に ETag を加えてください。",
    rejected: (status) => `ストレージサービスがアップロードを HTTP ${status} で拒否しました。`,
    failed: "アップロードに失敗しました。ネットワークとバケットの CORS ルールを確認してください。",
  },
  api: {
    unreachable: "albireo に接続できませんでした。サインインの期限が切れた場合は、ページを再読み込みしてください。",
    failed: (status) => `リクエストが HTTP ${status} で失敗しました。`,
  },
  files: {
    storageAnswered: (status) => `ストレージサービスが HTTP ${status} を返しました。`,
    unreadable: "ファイルを読み込めませんでした。ネットワークとバケットの CORS ルールを確認してください。",
    pdfFailed: (reason) => `PDF を開けませんでした：${reason}`,
  },
  home: {
    recommended: "おすすめ",
    play: "再生",
  },
  search: {
    title: "検索",
    resultsFor: (query) => `「${query}」の検索結果`,
  },
  notFound: {
    title: "見つかりません",
    message: "このページは存在しません。",
    back: "ライブラリに戻る",
  },
  video: {
    details: "詳細",
    resolution: "解像度",
    rating: "評価",
    episode: (episode) => `第 ${episode} 回`,
    previous: "前へ",
    next: "次へ",
    previousEpisode: (title) => `前の回：${title}`,
    nextEpisode: (title) => `次の回：${title}`,
    noSeries: "シリーズなし",
  },
  rating: {
    yourRating: "あなたの評価",
    stars: (stars) => `星 ${stars} つ`,
    clear: "取り消す",
  },
  comments: {
    comments: "コメント",
    placeholder: "コメントを追加",
    comment: "コメント",
    posting: "投稿中…",
    deleteQuestion: "このコメントを削除しますか？",
    deleteComment: "コメントを削除",
    playFrom: (time) => `${time} から再生`,
  },
  attachments: {
    attachments: "添付ファイル",
    attach: "添付",
    tooLarge: (size) => `添付ファイルは ${size} までです。`,
    uploading: (fileName, percent) => `${fileName} をアップロード中 ${percent}%`,
    preview: "プレビュー",
    download: "ダウンロード",
    closePreview: "プレビューを閉じる",
    removeFile: (fileName) => `${fileName} を削除`,
    removeQuestion: "この添付ファイルを削除しますか？",
  },
  series: {
    episodes: "エピソード",
    episode: "回",
    actions: "操作",
    actionsFor: (title) => `${title} の操作`,
    moveEarlier: "前へ移動",
    moveLater: "後ろへ移動",
    removeFromSeries: "シリーズから外す",
  },
  account: {
    details: "基本情報",
    email: "メールアドレス",
    role: "役割",
    admin: "管理者",
    member: "メンバー",
    joined: "登録日",
    preferences: "表示",
    language: "言語",
    signIn: "サインイン",
    loginMethod: "ログイン方法",
    signedIn: "サインイン日時",
    passkey: "パスキー",
    oneTimePin: "ワンタイム PIN",
    passkeys: "パスキー",
    name: "名前",
    added: "追加日",
    lastUsed: "最終使用",
    sessions: "セッション",
    logOutOfThisDevice: "このデバイスからログアウト",
    device: "デバイス",
    location: "場所",
    lastActive: "最終アクセス",
    thisDevice: "このデバイス",
    deviceName: (browser, os) => `${os} の ${browser}`,
    unknownDevice: "不明なデバイス",
    place: (city, country) => (city !== "" && country !== "" ? `${city}（${country}）` : city || country),
  },
  channel: {
    picture: "プロフィール画像",
    changePicture: "画像を変更",
    displayName: "表示名",
    bio: "自己紹介",
    saved: "保存しました。",
    zoom: "拡大",
    apply: "適用",
    notPicture: "JPEG、PNG、WebP などの画像を選んでください。",
    uploadFailed: "画像をストレージサービスにアップロードできませんでした。",
    unreadable: "ブラウザがこのファイルを画像として読み込めません。JPEG、PNG、WebP の画像を選んでください。",
    cannotDraw: "ブラウザが画像を描画できません。",
    cannotEncode: "ブラウザが画像を JPEG にできません。",
  },
};

const MESSAGES: Record<Language, Messages> = { en, ja };

/** The name of each language in itself, as the account page lists them. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ja: "日本語" };

let current: Language = "en";
const listeners = new Set<() => void>();

/**
 * Switches the app to a language. Every component that reads the words renders again, and
 * the document takes the language, which screen readers and the fonts follow. The session
 * calls it with the language of the signed-in person.
 */
export function setLanguage(language: Language): void {
  document.documentElement.lang = language;
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language of the app, for what the browser formats, such as the names of countries. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, () => current);
}

/** The words of the app in its language. */
export function useT(): Messages {
  return MESSAGES[useLanguage()];
}

/** The words in the language of the moment, for code outside components, such as the errors of an upload. */
export function currentMessages(): Messages {
  return MESSAGES[current];
}
