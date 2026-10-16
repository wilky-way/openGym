// QR images use the browser decoder; live capture is CameraScan.jsx.
export async function importCodeFromImage(file) {
  if (!file) return null
  return (await import('./scan-web.js')).importCodeFromImageWeb(file)
}
