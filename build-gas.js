const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const frontendRoot = path.join(projectRoot, 'frontend');
const backendRoot = path.join(projectRoot, 'backend');
const outputRoot = path.join(projectRoot, 'apps-script');

const pages = [
  { source: 'student/login.html', output: 'StudentLogin.html', guard: 'studentLoginForm' },
  { source: 'student/register.html', output: 'StudentRegister.html', guard: 'studentRegisterForm' },
  { source: 'student/chatbot.html', output: 'StudentChatbot.html', guard: 'chat-window' },
  { source: 'student/dashboard.html', output: 'StudentDashboard.html', guard: 'student-dashboard' },
  { source: 'student/screening.html', output: 'StudentScreening.html', guard: 'student-screening' },
  { source: 'student/progress.html', output: 'StudentProgress.html', guard: 'student-progress' },
  { source: 'student/resources.html', output: 'StudentResources.html', guard: 'student-resources' },
  { source: 'student/profile.html', output: 'StudentProfile.html', guard: 'student-profile' },
  { source: 'counselor/login.html', output: 'CounselorLogin.html', guard: 'counselorLoginForm' },
  { source: 'counselor/register.html', output: 'CounselorRegister.html', guard: 'counselorRegisterForm' },
  { source: 'counselor/ai-reviews.html', output: 'CounselorReviews.html', guard: 'reviews-container' },
  { source: 'counselor/portal.html', output: 'CounselorPortal.html', guard: 'counselor-portal' }
];

function readPage(page) {
  const sourcePath = path.join(frontendRoot, page.source);
  const html = fs.readFileSync(sourcePath, 'utf8');
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const markup = body ? body[1] : html;
  return {
    html,
    body: markup
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .trim(),
    styles: Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), match => match[1].trim()),
    scripts: Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match => match[1].trim())
  };
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(outputRoot, name), content, 'utf8');
}

fs.mkdirSync(outputRoot, { recursive: true });

const extractedPages = pages.map(page => ({ ...page, ...readPage(page) }));
const styleBlocks = [
  fs.readFileSync(path.join(frontendRoot, 'style.css'), 'utf8').trim(),
  ...extractedPages.flatMap(page => page.styles)
];
writeFile('Styles.html', '<style>\n' + styleBlocks.join('\n\n') + '\n</style>\n');

const libraryLinks = new Set();
extractedPages.forEach(page => {
  for (const match of page.html.matchAll(/<link\b[^>]*>/gi)) {
    if (/rel=["'](?:stylesheet|preconnect)["']/i.test(match[0])) {
      libraryLinks.add(match[0]);
    }
  }
});

extractedPages.forEach(page => {
  let body = page.body;
  if (page.output === 'StudentChatbot.html') {
    body = body
      .replace(/\s+onkeydown="[^"]*"/i, '')
      .replace(/\s+onclick="[^"]*"/i, '')
      .replace('id="chat-input"', 'id="chat-input"')
      .replace('<button class="btn btn-primary">Send</button>', '<button class="btn btn-primary" id="chat-send-button" type="button">Send</button>');
  }
  writeFile(page.output, body + '\n');
});

const helperScript = fs.readFileSync(path.join(frontendRoot, 'js', 'ui.js'), 'utf8').trim();
const scopedScripts = extractedPages.map(page => {
  const scripts = page.scripts.join('\n\n');
  const chatEvents = page.output === 'StudentChatbot.html'
    ? [
      "    const input = document.getElementById('chat-input');",
      "    const sendButton = document.getElementById('chat-send-button');",
      "    input.addEventListener('keydown', function (event) {",
      "      if (event.key === 'Enter') sendMessage();",
      '    });',
      "    sendButton.addEventListener('click', sendMessage);"
    ].join('\n')
    : '';
  return "if (document.getElementById('" + page.guard + "')) {\n" + scripts + '\n' + chatEvents + '\n}\n';
}).join('\n');
writeFile('JavaScript.html', '<script>\n' + helperScript + '\n\n' + scopedScripts + '\n</script>\n');

writeFile('Index.html', [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <base href="<?= webAppUrl ?>" target="_top">',
  '  <meta charset="UTF-8">',
  '  <title>MindBridge</title>',
  ...Array.from(libraryLinks, link => '  ' + link),
  "  <?!= include('Styles'); ?>",
  '</head>',
  '<body class="<?= pageBodyClass ?>" data-web-app-url="<?= webAppUrl ?>" data-page-key="<?= pageKey ?>">',
  "  <? if (isStudentPage) { ?>",
  "  <?!= include('StudentNav'); ?>",
  '  <? } ?>',
  "  <? if (isCounselorPage) { ?>",
  "  <?!= include('CounselorNav'); ?>",
  '  <? } ?>',
  "  <?!= include(pageFile); ?>",
  "  <?!= include('JavaScript'); ?>",
  '</body>',
  '</html>',
  ''
].join('\n'));

writeFile('StudentNav.html', fs.readFileSync(path.join(frontendRoot, 'student', 'navigation.html'), 'utf8'));
writeFile('CounselorNav.html', fs.readFileSync(path.join(frontendRoot, 'counselor', 'navigation.html'), 'utf8'));

for (const entry of fs.readdirSync(backendRoot, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.gs')) {
    fs.copyFileSync(path.join(backendRoot, entry.name), path.join(outputRoot, entry.name));
  }
}

writeFile('appsscript.json', JSON.stringify({
  timeZone: 'Asia/Singapore',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: {
    executeAs: 'USER_DEPLOYING',
    access: 'ANYONE_ANONYMOUS'
  }
}, null, 2) + '\n');

console.log('Generated Apps Script project in ' + outputRoot);
