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
.header{width:100%;background:var(--steel);border-bottom:3px solid var(--amber);padding:28px 24px 22px;text-align:center;}
.header-logo{width:96px;height:96px;border-radius:50%;margin:0 auto 14px;display:block;}
.header-name{font-family:var(--sans);font-size:18px;font-weight:800;color:white;letter-spacing:.01em;line-height:1.2;}
.header-tag{font-family:var(--sans);font-size:11px;font-weight:600;color:var(--amber);margin-top:5px;letter-spacing:.04em;}

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
  <div class="header-name">Timothy Lutheran Church</div>
  <div class="header-tag">from our Neighborhood to the Nations</div>
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

  <a class="link-card" href="/contact.vcf">
    <div class="card-icon icon--mist">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3D627C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M9 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M15 8h2M15 12h2M9 14c-2 0-4 1-4 2v0h8v0c0-1-2-2-4-2z"/></svg>
    </div>
    <div class="card-text">
      <div class="card-title">Save Our Contact</div>
      <div class="card-desc">Add Timothy Lutheran to your phone contacts</div>
    </div>
    <span class="card-arrow">&#x203A;</span>
  </a>

</div>

<div class="footer">
  <div class="footer-address">6704 Fyler Ave · St. Louis, MO 63139</div>
  <div class="footer-detail"><a href="tel:+13147818673">(314) 781-8673</a> · <a href="https://timothystl.org">timothystl.org</a></div>
</div>

</body>
</html>`;
