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
    done: "Done",
    save: "Save",
    saving: "Saving...",
    edit: "Edit",
    remove: "Remove",
    delete: "Delete",
    /** For screen readers while a part of the page loads. */
    loading: "Loading",
    loadingMore: "Loading...",
    title: "Title",
    description: "Description",
    series: "Series",
    playlists: "Playlists",
    videos: "Videos",
    noVideosYet: "No videos yet",
    allVideos: "All videos",
    channelSettings: "Channel settings",
    account: "Account",
    uploadedBy: "Uploaded by",
    date: "Date",
    length: "Length",
    reload: "Reload",
  },
  shell: {
    skipToContent: "Skip to content",
    menu: "Menu",
    openMenu: "Open the menu",
    closeMenu: "Close the menu",
    search: "Search",
    accountOf: (name: string) => `Account of ${name}`,
    yourChannel: "Your channel",
    library: "Library",
    home: "Home",
    history: "History",
    newSeries: "New series",
    newPlaylist: "New playlist",
    showAll: "Show all",
    seriesTitle: "Series title",
    playlistTitle: "Playlist title",
    create: "Create",
    creating: "Creating...",
  },
  upload: {
    upload: "Upload",
    dismiss: "Dismiss",
    reading: "Reading the video...",
    finishing: "Finishing the upload...",
    progress: (percent: number, uploaded: string, total: string) => `Uploading ${percent}% (${uploaded} of ${total})`,
    waiting: "Waiting",
    uploaded: "Uploaded",
    failedLabel: "Failed",
    cancelAll: "Cancel all",
    cancelFile: (name: string) => `Cancel ${name}`,
    failedFile: (name: string, reason: string) => `${name}: ${reason}`,
    notVideos: (names: string[]) => `Not added, because they are not videos: ${names.join(", ")}`,
    dropToUpload: "Drop to upload",
    dropHere: "Drop videos here",
    chooseFiles: "Choose files",
    notVideo: "Choose a video file. The browser does not recognize this file as a video.",
    noPartUrl: (part: number) => `The API returned no URL for part ${part}.`,
    etagHidden: "albireo answered a part of the upload without its ETag.",
    rejected: (status: number) => `The upload failed with HTTP ${status}.`,
    failed: "The upload failed. Check the network.",
  },
  api: {
    unreachable: "albireo could not be reached. Check the network, and that albireo is running.",
    failed: (status: number) => `The request failed with HTTP ${status}.`,
  },
  files: {
    answered: (status: number) => `albireo answered HTTP ${status}.`,
    unreadable: "The file could not be read. Check the network.",
    pdfFailed: (reason: string) => `The PDF could not be opened: ${reason}`,
    firstRows: (count: number) => `The first ${count.toLocaleString("en")} rows.`,
  },
  sort: {
    label: "Sort",
    newest: "Newest",
    oldest: "Oldest",
    rating: "Highest rated",
  },
  search: {
    title: "Search",
    resultsFor: (query: string) => `Results for “${query}”`,
    showAll: "Show all",
    showFewer: "Show fewer",
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
    episodeOf: (episode: number, count: number) => `Episode ${episode} of ${count}`,
    noSeries: "No series",
    editVideo: "Edit video",
    deleteQuestion: "Delete this video?",
    deleteRemovesAll: "Its file, thumbnail, attachments, comments, and ratings are deleted for good.",
  },
  rating: {
    yourRating: "Your rating",
    stars: (stars: number) => (stars === 1 ? "1 star" : `${stars} stars`),
    averageOf: (average: number, count: number) =>
      count === 0 ? "Not rated yet" : `Rated ${average.toFixed(1)} by ${count === 1 ? "1 person" : `${count} people`}`,
    clear: "Clear",
  },
  comments: {
    comments: "Comments",
    count: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
    placeholder: "Add a comment",
    comment: "Comment",
    posting: "Posting...",
    deleteQuestion: "Delete this comment?",
    deleteComment: "Delete the comment",
    playFrom: (time: string) => `Play from ${time}`,
  },
  attachments: {
    attachments: "Attachments",
    count: (count: number) => (count === 1 ? "1 attachment" : `${count} attachments`),
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
    noEpisodesYet: "No videos in this series yet",
    deleteQuestion: "Delete this series?",
    deleteKeepsVideos: "Its videos stay in the library, out of any series.",
    addToSeries: "Add to series",
  },
  thumbnail: {
    thumbnail: "Thumbnail",
    chooseFrame: "Choose a frame",
    useFrame: "Use this frame",
    place: "Place in the video",
    cannotRead: "The browser cannot read this video.",
  },
  playlists: {
    playlist: "Playlist",
    addToPlaylist: "Add to playlist",
    playAll: "Play all",
    number: "No.",
    positionOf: (position: number, count: number) => `${position} of ${count}`,
    removeFromPlaylist: "Remove from the playlist",
    deleteQuestion: "Delete this playlist?",
    deleteKeepsVideos: "Its videos stay in the library.",
  },
  account: {
    details: "Details",
    joined: "Joined",
    preferences: "Preferences",
    language: "Language",
  },
  channel: {
    picture: "Picture",
    changePicture: "Change picture",
    displayName: "Display name",
    bio: "Bio",
    zoom: "Zoom",
    apply: "Apply",
    notPicture: "Choose a picture, such as a JPEG, PNG, or WebP image.",
    uploadFailed: "The picture could not be uploaded.",
    unreadable: "The browser cannot read this file as a picture. Choose a JPEG, PNG, or WebP image.",
    cannotDraw: "The browser cannot draw the picture.",
    cannotEncode: "The browser cannot make a JPEG of the picture.",
  },
  toast: {
    notifications: "Notifications",
    close: "Close",
    open: "Open",
    saved: "Saved",
    uploaded: (title: string) => `Uploaded “${title}”`,
    uploadFailed: (fileName: string) => `Could not upload ${fileName}`,
    created: (title: string) => `Created “${title}”`,
    deleted: (title: string) => `Deleted “${title}”`,
    addedTo: (title: string) => `Added to “${title}”`,
    removedFrom: (title: string) => `Removed from “${title}”`,
    attached: (fileName: string) => `Attached ${fileName}`,
    removedFile: (fileName: string) => `Removed ${fileName}`,
    commentPosted: "Comment posted",
    thumbnailChanged: "Thumbnail changed",
    commentDeleted: "Comment deleted",
  },
};

/** The words of the app in one language. */
export type Messages = typeof en;

const ja: Messages = {
  common: {
    cancel: "キャンセル",
    done: "完了",
    save: "保存",
    saving: "保存中…",
    edit: "編集",
    remove: "削除",
    delete: "削除",
    loading: "読み込み中",
    loadingMore: "読み込み中…",
    title: "タイトル",
    description: "説明",
    series: "シリーズ",
    playlists: "再生リスト",
    videos: "動画",
    noVideosYet: "まだ動画がありません",
    allVideos: "すべての動画",
    channelSettings: "チャンネルの設定",
    account: "アカウント",
    uploadedBy: "投稿者",
    date: "投稿日",
    length: "長さ",
    reload: "再読み込み",
  },
  shell: {
    skipToContent: "本文へスキップ",
    menu: "メニュー",
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
    search: "検索",
    accountOf: (name) => `${name} のアカウント`,
    yourChannel: "自分のチャンネル",
    library: "ライブラリ",
    home: "ホーム",
    history: "履歴",
    newSeries: "新しいシリーズ",
    newPlaylist: "新しい再生リスト",
    showAll: "すべて表示",
    seriesTitle: "シリーズのタイトル",
    playlistTitle: "再生リストのタイトル",
    create: "作成",
    creating: "作成中…",
  },
  upload: {
    upload: "アップロード",
    dismiss: "閉じる",
    reading: "動画を読み込んでいます…",
    finishing: "アップロードを仕上げています…",
    progress: (percent, uploaded, total) => `アップロード中 ${percent}%（${uploaded} / ${total}）`,
    waiting: "待機中",
    uploaded: "完了",
    failedLabel: "失敗",
    cancelAll: "すべて取り消す",
    cancelFile: (name) => `${name} を取り消す`,
    failedFile: (name, reason) => `${name}：${reason}`,
    notVideos: (names) => `動画ではないため追加しませんでした：${names.join("、")}`,
    dropToUpload: "ドロップしてアップロード",
    dropHere: "ここに動画をドロップ",
    chooseFiles: "ファイルを選ぶ",
    notVideo: "動画ファイルを選んでください。ブラウザはこのファイルを動画として認識できません。",
    noPartUrl: (part) => `API がパート ${part} の URL を返しませんでした。`,
    etagHidden: "albireo がアップロードのパートに ETag を付けずに応答しました。",
    rejected: (status) => `アップロードが HTTP ${status} で失敗しました。`,
    failed: "アップロードに失敗しました。ネットワークを確認してください。",
  },
  api: {
    unreachable: "albireo に接続できませんでした。ネットワークと、albireo が動いていることを確認してください。",
    failed: (status) => `リクエストが HTTP ${status} で失敗しました。`,
  },
  files: {
    answered: (status) => `albireo が HTTP ${status} を返しました。`,
    unreadable: "ファイルを読み込めませんでした。ネットワークを確認してください。",
    pdfFailed: (reason) => `PDF を開けませんでした：${reason}`,
    firstRows: (count) => `最初の ${count.toLocaleString("ja")} 行です。`,
  },
  sort: {
    label: "並べ替え",
    newest: "新しい順",
    oldest: "古い順",
    rating: "評価が高い順",
  },
  search: {
    title: "検索",
    resultsFor: (query) => `「${query}」の検索結果`,
    showAll: "すべて表示",
    showFewer: "折りたたむ",
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
    episodeOf: (episode, count) => `第 ${episode} 回（全 ${count} 回）`,
    noSeries: "シリーズなし",
    editVideo: "動画を編集",
    deleteQuestion: "この動画を削除しますか？",
    deleteRemovesAll: "動画のファイル、サムネイル、添付ファイル、コメント、評価もすべて消え、元に戻せません。",
  },
  rating: {
    yourRating: "あなたの評価",
    averageOf: (average, count) => (count === 0 ? "まだ評価がありません" : `評価 ${average.toFixed(1)}（${count} 人）`),
    stars: (stars) => `星 ${stars} つ`,
    clear: "取り消す",
  },
  comments: {
    comments: "コメント",
    count: (count) => `コメント ${count} 件`,
    placeholder: "コメントを追加",
    comment: "コメント",
    posting: "投稿中…",
    deleteQuestion: "このコメントを削除しますか？",
    deleteComment: "コメントを削除",
    playFrom: (time) => `${time} から再生`,
  },
  attachments: {
    attachments: "添付ファイル",
    count: (count) => `添付ファイル ${count} 件`,
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
    noEpisodesYet: "このシリーズにはまだ動画がありません",
    deleteQuestion: "このシリーズを削除しますか？",
    deleteKeepsVideos: "動画はシリーズから外れて、ライブラリに残ります。",
    addToSeries: "シリーズに追加",
  },
  thumbnail: {
    thumbnail: "サムネイル",
    chooseFrame: "場面を選ぶ",
    useFrame: "この場面にする",
    place: "動画の位置",
    cannotRead: "ブラウザがこの動画を読めません。",
  },
  playlists: {
    playlist: "再生リスト",
    addToPlaylist: "再生リストに追加",
    playAll: "すべて再生",
    number: "番号",
    positionOf: (position, count) => `${count} 本中 ${position} 本目`,
    removeFromPlaylist: "再生リストから外す",
    deleteQuestion: "この再生リストを削除しますか？",
    deleteKeepsVideos: "動画はライブラリに残ります。",
  },
  account: {
    details: "基本情報",
    joined: "登録日",
    preferences: "表示",
    language: "言語",
  },
  channel: {
    picture: "プロフィール画像",
    changePicture: "画像を変更",
    displayName: "表示名",
    bio: "自己紹介",
    zoom: "拡大",
    apply: "適用",
    notPicture: "JPEG、PNG、WebP などの画像を選んでください。",
    uploadFailed: "画像をアップロードできませんでした。",
    unreadable: "ブラウザがこのファイルを画像として読み込めません。JPEG、PNG、WebP の画像を選んでください。",
    cannotDraw: "ブラウザが画像を描画できません。",
    cannotEncode: "ブラウザが画像を JPEG にできません。",
  },
  toast: {
    notifications: "通知",
    close: "閉じる",
    open: "開く",
    saved: "保存しました",
    uploaded: (title) => `「${title}」をアップロードしました`,
    uploadFailed: (fileName) => `${fileName} をアップロードできませんでした`,
    created: (title) => `「${title}」を作成しました`,
    deleted: (title) => `「${title}」を削除しました`,
    addedTo: (title) => `「${title}」に追加しました`,
    removedFrom: (title) => `「${title}」から外しました`,
    attached: (fileName) => `${fileName} を添付しました`,
    removedFile: (fileName) => `${fileName} を削除しました`,
    commentPosted: "コメントを投稿しました",
    thumbnailChanged: "サムネイルを変えました",
    commentDeleted: "コメントを削除しました",
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
 * calls it with the language of the person.
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
