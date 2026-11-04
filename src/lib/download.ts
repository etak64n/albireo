// Saves an attachment under its own name.

/**
 * Reads the file and saves it under the name. Signed URLs also ask the storage service
 * for that name, but not every service answers with it, and cf dev ignores it.
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The storage service answered HTTP ${response.status}.`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started from the click; the memory goes once the browser has the file.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
