// Timothy Lutheran Church — Links Worker
// Purpose: Serves the social/links landing page at links.timothystl.org
// Deploy: Cloudflare Worker (no database — fully self-contained static response)
// Dependencies: None (logo loaded from timothystl.org/logo.png)
// Last modified: 2026-03-28

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Serve vCard for "Save Contact"
    if (url.pathname === '/contact.vcf') {
      return new Response(
`BEGIN:VCARD
VERSION:3.0
FN:Timothy Lutheran Church
ORG:Timothy Lutheran Church
ADR;TYPE=WORK:;;6704 Fyler Ave;St. Louis;MO;63139;USA
TEL;TYPE=WORK,VOICE:(314) 781-8673
EMAIL;TYPE=WORK:office@timothystl.org
URL:https://timothystl.org
END:VCARD`,
        {
          headers: {
            'Content-Type': 'text/vcard; charset=utf-8',
            'Content-Disposition': 'attachment; filename="timothy-lutheran.vcf"',
            'Cache-Control': 'public, max-age=86400',
          },
        }
      );
    }

    // All other paths serve the links page
    return new Response(HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Timothy Lutheran Church — from our Neighborhood to the Nations.">
<title>Timothy Lutheran Church</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --steel:#0A3C5C;--steel-dk2:#0A2038;
  --mid:#3D627C;--sky:#5C8FA8;--ice:#C4DDE8;--mist:#EDF5F8;
  --amber:#D4922A;
  --sage:#6B8F71;
  --warm:#C4DDE8;--white:#FFFFFF;
  --border:#E8E0D0;--charcoal:#3D3530;--gray:#7A6E60;
  --serif:'Lora',Georgia,serif;--sans:'Source Sans 3',Arial,sans-serif;
  --shadow:0 2px 12px rgba(10,60,92,.07);--shadow-lift:0 6px 32px rgba(10,60,92,.13);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--sans);color:var(--charcoal);background:var(--warm);min-height:100vh;display:flex;flex-direction:column;align-items:center;}

/* Header */
.header{width:100%;background:var(--steel);border-bottom:3px solid var(--amber);padding:16px 24px;display:flex;align-items:center;justify-content:center;gap:14px;}
.header-logo{width:48px;height:48px;border-radius:50%;flex-shrink:0;}
.header-name{font-family:var(--sans);font-size:17px;font-weight:800;color:white;letter-spacing:.01em;line-height:1.2;}
.header-tag{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--amber);margin-top:3px;letter-spacing:.04em;}

/* Main */
.main{width:100%;max-width:480px;padding:16px 20px 32px;display:flex;flex-direction:column;gap:12px;}

/* Link cards */
.link-card{display:flex;align-items:center;gap:16px;background:var(--white);border:1px solid var(--border);border-radius:14px;padding:18px 20px;text-decoration:none;color:var(--charcoal);box-shadow:var(--shadow);transition:transform .15s,box-shadow .15s,border-color .15s;}
.link-card:hover,.link-card:focus{transform:translateY(-2px);box-shadow:var(--shadow-lift);border-color:var(--ice);outline:none;}
.link-card:active{transform:translateY(0);box-shadow:var(--shadow);}

.card-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.icon--amber{background:#FEF3DC;}
.icon--sage{background:#E8F2E9;}
.icon--sky{background:#E4EEF4;}
.icon--mist{background:var(--mist);}

.card-text{flex:1;min-width:0;}
.card-title{font-family:var(--serif);font-size:17px;font-weight:700;color:var(--steel);line-height:1.2;}
.card-desc{font-family:var(--sans);font-size:13px;color:var(--gray);margin-top:3px;line-height:1.4;}

.card-arrow{color:var(--ice);font-size:20px;flex-shrink:0;transition:color .15s;}
.link-card:hover .card-arrow{color:var(--sky);}

/* Newsletter signup card */
.signup-card{background:var(--white);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;}
.signup-card-header{display:flex;align-items:center;gap:16px;padding:18px 20px;cursor:pointer;transition:background .15s;}
.signup-card-header:hover{background:var(--mist);}
.signup-form-wrap{display:none;padding:0 20px 20px;}
.signup-form-wrap.open{display:block;}
.signup-input{width:100%;background:#F9F6F0;border:1px solid var(--border);border-radius:10px;padding:11px 14px;font-family:var(--sans);font-size:15px;color:var(--charcoal);margin-bottom:10px;outline:none;transition:border-color .2s;}
.signup-input:focus{border-color:var(--amber);}
.signup-btn{width:100%;background:var(--steel);color:white;font-family:var(--sans);font-size:15px;font-weight:700;border:none;border-radius:10px;padding:13px;cursor:pointer;transition:background .15s;}
.signup-btn:hover{background:#0D3050;}
.signup-btn:disabled{opacity:.6;cursor:default;}
.signup-msg{margin-top:12px;font-family:var(--sans);font-size:14px;text-align:center;}

/* Footer */
.footer{width:100%;max-width:480px;padding:0 20px 40px;text-align:center;display:flex;flex-direction:column;gap:4px;}
.footer-address{font-family:var(--sans);font-size:13px;color:var(--charcoal);font-weight:600;}
.footer-detail{font-family:var(--sans);font-size:12px;color:var(--gray);}
.footer-detail a{color:var(--mid);text-decoration:none;}
.footer-detail a:hover{color:var(--steel);}
</style>
</head>
<body>

<div class="header">
  <img class="header-logo" src="https://timothystl.org/logo.png" alt="Timothy Lutheran Church">
  <div>
    <div class="header-name">Timothy Lutheran Church</div>
    <div class="header-tag">from our Neighborhood to the Nations</div>
  </div>
</div>

<div class="main">

  <a class="link-card" href="https://timothystl.org/contact" target="_blank" rel="noopener">
    <div class="card-icon icon--sage">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B8F71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Get Connected</div>
      <div class="card-desc">We'd love to know you — say hello</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

  <a class="link-card" href="https://timothystl.org/prayer" target="_blank" rel="noopener">
    <div class="card-icon icon--mist">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3D627C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Prayer Request</div>
      <div class="card-desc">Share what's on your heart — we carry it with you</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

  <a class="link-card" href="https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8" target="_blank" rel="noopener">
    <div class="card-icon icon--amber">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4922A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Give</div>
      <div class="card-desc">Support the ministry of Timothy</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

  <a class="link-card" href="https://volunteer.timothystl.org" target="_blank" rel="noopener noreferrer">
    <div class="card-icon icon--sage">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B8F71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><path d="M12 21.23V12"/><path d="M7.5 9.5L12 12l4.5-2.5"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Volunteer</div>
      <div class="card-desc">Find your place to serve</div>
    </div>
    <span class="card-arrow">›</span>
  </a>

  <a class="link-card" href="https://timothystl.org/news" target="_blank" rel="noopener">
    <div class="card-icon icon--sky">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C8FA8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10l6 6v8a2 2 0 0 1-2 2z"/><polyline points="15 2 15 8 21 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="11" y2="11"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">News &amp; Events</div>
      <div class="card-desc">What's coming up at Timothy</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

  <a class="link-card" href="https://timothystl.org/sermons" target="_blank" rel="noopener">
    <div class="card-icon icon--sky">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C8FA8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Sermon Notes</div>
      <div class="card-desc">Take today's message home with you</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

  <div class="signup-card" id="signup-card">
    <div class="signup-card-header" onclick="toggleSignup()" role="button" aria-expanded="false" id="signup-header">
      <div class="card-icon icon--amber">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D4922A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <div class="card-text">
        <div class="card-title">Get the Newsletter</div>
        <div class="card-desc">Weekly news &amp; a word from Pastor Dinger</div>
      </div>
      <span class="card-arrow" id="signup-chevron">&#x203A;</span>
    </div>
    <div class="signup-form-wrap" id="signup-form-wrap">
      <form id="signup-form" onsubmit="submitSignup(event)" autocomplete="off">
        <input class="signup-input" type="text" name="name" placeholder="Your name (optional)" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
        <input class="signup-input" type="email" name="email" placeholder="Email address" required autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore>
        <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">
        <button class="signup-btn" type="submit" id="signup-btn">Subscribe →</button>
      </form>
      <div class="signup-msg" id="signup-msg"></div>
    </div>
  </div>

</div>

<div class="footer">
  <div class="footer-address">6704 Fyler Ave · St. Louis, MO 63139</div>
  <div class="footer-detail"><a href="tel:+13147818673">(314) 781-8673</a> · <a href="https://timothystl.org">timothystl.org</a></div>
</div>

<script>
function toggleSignup() {
  var wrap = document.getElementById('signup-form-wrap');
  var chevron = document.getElementById('signup-chevron');
  var header = document.getElementById('signup-header');
  var open = wrap.classList.toggle('open');
  chevron.innerHTML = open ? '&#x2039;' : '&#x203A;';
  header.setAttribute('aria-expanded', open);
  if (open) wrap.querySelector('input[type="email"]').focus();
}
async function submitSignup(e) {
  e.preventDefault();
  var btn = document.getElementById('signup-btn');
  var msg = document.getElementById('signup-msg');
  btn.disabled = true; btn.textContent = 'Subscribing…';
  msg.style.color = ''; msg.textContent = '';
  try {
    var fd = new FormData(e.target);
    var r = await fetch('https://admin.timothystl.org/api/subscribe', { method: 'POST', body: fd });
    var d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Error');
    document.getElementById('signup-form').style.display = 'none';
    msg.style.color = '#2E7D32';
    msg.textContent = "You're on the list! 🎉 Look for us in your inbox.";
  } catch(err) {
    msg.style.color = '#B00020';
    msg.textContent = err.message || 'Something went wrong. Please try again.';
    btn.disabled = false; btn.textContent = 'Subscribe →';
  }
}
</script>
</body>
</html>`;
