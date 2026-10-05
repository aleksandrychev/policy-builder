// Vite's `?raw` import: the file's text (electron-vite declares none for main).
declare module '*?raw' {
  const text: string;
  export default text;
}
