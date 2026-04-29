// reader.js - Logic for the isolated reader tab
const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get('file');

if (!pdfUrl) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = '<div style="padding: 40px; font-family: sans-serif;"><h1>No PDF specified</h1><p>Please open a PDF file and click the extension icon.</p></div>';
  });
} else {
  console.log('Isolated Reader Tab Initialized for:', pdfUrl);
  window.IS_ISOLATED_READER = true;
  window.PDF_SOURCE_URL = pdfUrl;

  document.addEventListener('DOMContentLoaded', () => {
    const embed = document.createElement('embed');
    embed.type = 'application/pdf';
    embed.src = pdfUrl;
    embed.style.position = 'fixed';
    embed.style.inset = '0';
    embed.style.width = '100vw';
    embed.style.height = '100vh';
    embed.style.zIndex = '-1';
    embed.id = 'native-pdf-embed';
    document.body.appendChild(embed);
  });
}
