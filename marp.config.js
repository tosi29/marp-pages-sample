module.exports = {
  inputDir: 'slides',
  output: 'docs',
  allowLocalFiles: true,
  html: true,
  options: {
    pdfChromiumArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  },  
  themeSet: [
    'themes/brand.css',
    'slides/alice/hello-world/_theme/hello-world.css',
  ],
};
