const fs = require('fs');
const path = require('path');

const projectDir = path.join(__dirname, 'project');
const whiteLogoPath = path.join(projectDir, 'assets', 'logo-white.png');
const blackLogoPath = path.join(projectDir, 'assets', 'logo-black.png');

const whiteBase64 = 'data:image/png;base64,' + fs.readFileSync(whiteLogoPath).toString('base64');
const blackBase64 = 'data:image/png;base64,' + fs.readFileSync(blackLogoPath).toString('base64');

// Update JS variables in script.js and html files
const updateJsVars = (content) => {
  content = content.replace(/var BLACK = "data:image\/png;base64,[A-Za-z0-9+/=]+";/g, 'var BLACK = "' + blackBase64 + '";');
  content = content.replace(/var WHITE = "data:image\/png;base64,[A-Za-z0-9+/=]+";/g, 'var WHITE = "' + whiteBase64 + '";');
  return content;
};

// Update img tags in html files
const updateImgTags = (content) => {
  content = content.replace(/<img[^>]*?class="[^"]*logo-light[^"]*"[^>]*?>|<img[^>]*?src="data:image\/png;base64,[A-Za-z0-9+/=]+"[^>]*?class="[^"]*logo-light[^"]*"[^>]*?>/g, 
    '<img src="' + blackBase64 + '" alt="swaP" class="logo-light" style="height:64px;width:auto;object-fit:contain;display:block;">'
  );
  content = content.replace(/<img[^>]*?class="[^"]*logo-dark[^"]*"[^>]*?>|<img[^>]*?src="data:image\/png;base64,[A-Za-z0-9+/=]+"[^>]*?class="[^"]*logo-dark[^"]*"[^>]*?>/g, 
    '<img src="' + whiteBase64 + '" alt="swaP" class="logo-dark" style="height:64px;width:auto;object-fit:contain;display:none;">'
  );
  return content;
};

// Update script.js
const scriptJsPath = path.join(projectDir, 'script.js');
if (fs.existsSync(scriptJsPath)) {
  let scriptJsContent = fs.readFileSync(scriptJsPath, 'utf8');
  scriptJsContent = updateJsVars(scriptJsContent);
  fs.writeFileSync(scriptJsPath, scriptJsContent);
}

// Update HTML files
const files = fs.readdirSync(projectDir);
for (const file of files) {
  if (file.endsWith('.html')) {
    const filePath = path.join(projectDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    content = updateJsVars(content);
    content = updateImgTags(content);
    fs.writeFileSync(filePath, content);
  }
}
console.log('Logos successfully updated!');
